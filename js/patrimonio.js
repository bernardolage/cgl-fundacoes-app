/* ====================================================================
   Módulo: Patrimônio (fase 97) — avaliação de mercado dos bens. Prefixo pat-.
   Spec: docs/specs/fase-97-patrimonio-avaliacao.md.

   Só diretor e auditor (podeVerPatrimonio() em core.js; admin NÃO vê). No banco a leitura é
   pode_ler_patrimonio() e a escrita patrimonio_pode_editar() (diretor), as duas com sessão aal2:
   sem MFA concluído a API devolve vazio, por isso a tela pede o código antes de carregar.

   O Patrimônio não cadastra, ativa nem retira equipamento ou acessório: lê os cadastros de
   Equipamentos/Logística (máquinas, caminhões, veículos) e de Acessórios (kits de trado de hélice e
   secante) pela vw_pat_bens e acrescenta a avaliação por ano (patrimonio_avaliacoes). Só os bens que
   não existem em outro módulo (imóveis da empresa/permuta, usina, grupos globais) nascem aqui, em
   patrimonio_bens. Veículo sem avaliação vale a FIPE que o app já guarda.

   Visões: Avaliação (a planilha viva, por grupo, valor do ano editável na célula pelo diretor),
   Vendas (atalho para a visão Vendas de Equipamentos, fase 96) e Resumo (totais por grupo, variação
   contra o ano anterior, "sem valor" e bens fora do patrimônio). Exporta .xlsx no leiaute da
   planilha. Nada deste módulo aparece em outra tela.

   Lote S54 (#172, 27/10/2026): dentro de "Acessórios das raízes" cada MODELO de acessório de raiz
   (acessorio_modelos; bem_tipo acessorio_modelo, bem_id = modelo) é um bem, agrupado na tela pela
   linha da Contagem Geral (grupo_contagem). Quantidade = peças ativas contáveis (vw_pat_bens);
   a avaliação do ano guarda quantidade, unitário por peça e rótulo; o diretor digita o unitário
   (sugestão = preco_referencia do modelo). A verba única continua até a diretoria retirá-la.
   ==================================================================== */

/* ---------- Estado do módulo ---------- */
let _patBens      = [];          /* vw_pat_bens: um bem próprio ativo por linha */
let _patAval      = [];          /* patrimonio_avaliacoes (todas, ano desc) */
let _patResumo    = [];          /* vw_pat_resumo: total por grupo e ano (grupo "total" = geral) */
let _patSemValor  = [];          /* vw_pat_sem_valor: pendência oficial do ano de referência */
let _patFora      = [];          /* equipamentos ativos locados ou de terceiro (fora do patrimônio) */
let _patAvalPorBem = new Map();  /* chave do bem → avaliações dele, ano desc */
let _patView      = "avaliacao"; /* avaliacao | resumo (Vendas é atalho para Equipamentos) */
let _patAno       = null;        /* ano de referência escolhido no filtro */
let _patCarregado = false;
let patEditKey    = null;        /* chave do bem aberto na ficha; "novo" = bem novo de patrimonio_bens */

/* ---------- Rótulos ---------- */
/* ordem e nome dos grupos = blocos da planilha AVALIAÇÃO DOS EQUIPAMENTOS (mais os grupos que o app tem e a planilha não) */
const PAT_GRUPOS = [
  ["helice",            "Hélice contínua monitorada"],
  ["secante",           "Estacas secantes"],
  ["raiz",              "Estacas raiz"],
  ["trado",             "Trado mecanizado / estações China"],
  ["perfuratriz_outra", "Outras perfuratrizes"],
  ["bomba",             "Bombas de concreto"],
  ["caminhao",          "Caminhões munck / pranchas"],
  ["escavadeira",       "Retro, mini e escavadeiras"],
  ["compressor",        "Compressores"],
  ["gerador",           "Geradores"],
  ["outro_equip",       "Outros equipamentos"],
  ["veiculo",           "Veículos leves (FIPE)"],
  ["trados_kits",       "Trados e tubos secantes"],
  ["acessorios_raiz",   "Acessórios das raízes"],
  ["ferramentas",       "Ferramentas do almoxarifado"],
  ["motores_pecas",     "Motores e peças de reposição"],
  ["imovel",            "Imóveis e instalações"],
  ["usina",             "Usina fotovoltaica"],
  ["ferramentaria",     "Ferramentaria (torno, solda, ponte rolante)"],
  ["outro",             "Outros bens"]
];
const PAT_GRUPO_ROTULO = Object.fromEntries(PAT_GRUPOS);
const PAT_GRUPO_ORDEM  = Object.fromEntries(PAT_GRUPOS.map(([g], i) => [g, i]));
/* grupos que nascem em patrimonio_bens (o resto vem dos cadastros de Equipamentos e Acessórios) */
const PAT_GRUPOS_BEM = ["imovel", "usina", "acessorios_raiz", "ferramentas", "motores_pecas", "ferramentaria", "outro"];
const PAT_BASES = { mercado: "Mercado", fipe: "FIPE", laudo: "Laudo", aquisicao: "Aquisição" };
const PAT_TIT_EQUIP = { propria: "Própria", locada: "Locada", terceiro: "De terceiro" };
const PAT_TIT_BEM = { empresa: "Em nome da empresa", permuta: "Em processo de permuta" };
const PAT_UNIDADES = { m2: "m²", vb: "VB", pc: "peças" };

/* ---------- Helpers ---------- */
function patPodeEditar(){ return !!usuarioAtual && usuarioAtual.cargo === "diretor"; }
const patChave = (b) => `${b.bem_tipo}:${b.bem_id}`;
const patRotuloGrupo = (g) => PAT_GRUPO_ROTULO[g] || g || "—";
const patOrdemGrupo = (g) => (PAT_GRUPO_ORDEM[g] ?? 99);
function patBemPorChave(k){ return _patBens.find(b => patChave(b) === k) || null; }
/* lote S54 (#172): bem de grupo = modelo de acessório de raiz (bem_tipo acessorio_modelo, bem_id = acessorio_modelos.id),
   dentro do grupo "Acessórios das raízes" e agrupado na tela pela linha da Contagem Geral (grupo_contagem; sem ele, o tipo). */
const patEhModelo = (b) => b && b.bem_tipo === "acessorio_modelo";
function patSubgrupo(b){
  if(b.grupo_contagem) return String(b.grupo_contagem).trim().toUpperCase();
  const t = b.tipo_acessorio;
  return (typeof ACE_TIPO_LBL === "object" && ACE_TIPO_LBL[t]) ? String(ACE_TIPO_LBL[t]).toUpperCase() : (t ? String(t).toUpperCase() : "OUTROS");
}
/* quantidade avaliada no ano × quantidade atual: "39 → 41 peças" quando mudou depois da avaliação */
function patQtdMudou(b, av){
  if(!patEhModelo(b) || !av || av.quantidade == null) return null;
  const antes = Number(av.quantidade), agora = Number(b.quantidade || 0);
  return antes === agora ? null : { antes, agora };
}
/* ordena TAG "07-HG" antes de "10-RZ" e "CGL-02" antes de "CGL-10" (número dentro do texto);
   modelos de raiz (sem TAG) vêm depois dos bens avulsos do grupo, por grupo da Contagem Geral e descrição */
function patCompararTag(a, b){
  const ma = patEhModelo(a), mb = patEhModelo(b);
  if(ma || mb){
    if(ma !== mb) return ma ? 1 : -1;
    return patSubgrupo(a).localeCompare(patSubgrupo(b), "pt-BR") || String(a.descricao || "").localeCompare(String(b.descricao || ""), "pt-BR", { numeric: true });
  }
  const ta = a.tag || "", tb = b.tag || "";
  if(ta && tb) return ta.localeCompare(tb, "pt-BR", { numeric: true });
  if(ta || tb) return ta ? -1 : 1;
  return String(a.descricao || "").localeCompare(String(b.descricao || ""), "pt-BR");
}
/* avaliações de um bem (kit de trado: de qualquer peça do jogo) */
function patAvaliacoesDo(b){ return _patAvalPorBem.get(patChave(b)) || []; }
/* valor do bem no ano: avaliação daquele ano; veículo sem avaliação vale a FIPE do app */
function patValorNoAno(b, ano){
  const av = patAvaliacoesDo(b).find(a => a.ano_referencia === ano);
  if(av) return { valor: Number(av.valor), base: av.base, aval: av };
  if(b.grupo === "veiculo" && b.valor_fipe != null) return { valor: Number(b.valor_fipe), base: "fipe", aval: null };
  return null;
}
function patUltimaAntes(b, ano){ return patAvaliacoesDo(b).find(a => a.ano_referencia < ano) || null; }
function patAnos(){
  const s = new Set(_patAval.map(a => a.ano_referencia));
  s.add(new Date().getFullYear());
  return [...s].sort((a, b) => b - a);
}
function patAnoPadrao(){
  return _patAval.length ? Math.max(..._patAval.map(a => a.ano_referencia)) : new Date().getFullYear();
}
function patBrlCurto(v){
  const n = Number(v || 0), abs = Math.abs(n);
  if(abs >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi";
  if(abs >= 1e3) return "R$ " + (n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil";
  return brl(n);
}
function patVariacaoTexto(r){
  if(!r || r.variacao == null) return "—";
  const n = Number(r.variacao), sinal = n > 0 ? "+" : n < 0 ? "−" : "";
  const pct = r.variacao_pct != null ? ` (${sinal}${Math.abs(Number(r.variacao_pct)).toLocaleString("pt-BR")} %)` : "";
  return `${sinal}${patBrlCurto(Math.abs(n))}${pct}`;
}
function patEstadoHtml(b){
  if(b.bem_tipo === "equipamento") return tagStatus("equipamento", b.status);
  if(b.bem_tipo === "acessorio") return String(b.status || "").split(",").map(s => s.trim()).filter(Boolean).map(s => tagStatus("acessorio", s)).join(" ") || "—";
  if(patEhModelo(b)){   // lote S54 (#172): "condicao:n, condicao:n" da view → uma tag por condição com a contagem (perdida pelo local)
    const partes = String(b.status || "").split(",").map(s => s.trim()).filter(s => s.includes(":"));
    if(!partes.length) return `<span class="tag cinza">${esc(b.status || "—")}</span>`;
    return partes.map(p => {
      const [cond, n] = p.split(":");
      const o = (STATUS.acessorio || {})[cond] || (cond === "perdido" ? (STATUS.acessorio_local || {}).perdido : null);
      return `<span class="tag ${o ? o.cor : "cinza"}" title="${esc(o ? o.label : cond)}">${esc(o ? o.label : cond)} · ${esc(n)}</span>`;
    }).join(" ");
  }
  const tag = b.titularidade_bem ? `<span class="tag ${b.titularidade_bem === "permuta" ? "ambar" : "verde"}">${esc(b.titularidade_bem === "permuta" ? "Permuta" : "Empresa")}</span>` : "—";
  // fase 98: imóvel em permuta mostra a permuta e o saldo a executar (vw_permutas, carregada por medicoes.js)
  return tag + (b.titularidade_bem === "permuta" && typeof pmPatChip === "function" ? pmPatChip(b.bem_id) : "");
}
function patSerieTexto(b){
  if(b.bem_tipo === "bem") return [b.numero_serie ? "Matrícula " + b.numero_serie : "", b.placa ? "Processo " + b.placa : ""].filter(Boolean).join(" · ");
  return [b.numero_serie, b.placa].filter(Boolean).join(" · ");
}
function patDetalheBem(b){
  if(patEhModelo(b)){   // lote S54 (#172): "227 peças em uso · 3 em manutenção · 2 sucata · unitário R$ … (2026)"
    const q = Number(b.quantidade || 0);
    const p = [`${num(q)} ${q === 1 ? "peça" : "peças"} em uso`];
    if(Number(b.qtd_manutencao)) p.push(`${num(b.qtd_manutencao)} em manutenção`);
    if(Number(b.qtd_sucata)) p.push(`${num(b.qtd_sucata)} sucata`);
    if(Number(b.qtd_perdida)) p.push(`${num(b.qtd_perdida)} perdida${Number(b.qtd_perdida) > 1 ? "s" : ""}`);
    if(b.valor_unitario_avaliado != null) p.push(`unitário ${brl(b.valor_unitario_avaliado)} (${b.ano_avaliacao})`);
    return p.join(" · ");
  }
  if(b.bem_tipo === "bem" && b.quantidade != null){
    const un = PAT_UNIDADES[b.unidade] || b.unidade || "";
    return `${num(b.quantidade)} ${un}${b.valor_unitario != null ? " × " + brl(b.valor_unitario) : ""}`;
  }
  if(b.bem_tipo === "acessorio") return [b.modelo, b.comprimento_m != null ? `${num(b.comprimento_m)} m` : ""].filter(Boolean).join(" · ");
  return [b.marca, b.modelo].filter(Boolean).join(" · ");
}

/* ---------- Sessão com MFA (aal2): sem ela o banco devolve vazio ---------- */
async function patNivelSessao(){
  try { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return data || null; } catch(_){ return null; }
}
function patMostrarPedidoMFA(nivel){
  ["pat-kpi-total", "pat-kpi-var", "pat-kpi-sem", "pat-kpi-bens"].forEach(id => { if($(id)) $(id).textContent = "—"; });
  $("pat-contador").textContent = "";
  const temFator = nivel && nivel.nextLevel === "aal2";
  $("pat-conteudo").innerHTML = temFator
    ? `<div class="pat-mfa">
        <p><strong>O Patrimônio exige a autenticação em dois fatores nesta sessão.</strong> Digite o código de 6 dígitos do aplicativo autenticador para abrir os valores.</p>
        <div class="pat-mfa-linha"><input id="pat-mfa-codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" />
        <button type="button" class="btn" id="btn-pat-mfa-ok">Confirmar código</button></div>
        <div id="pat-mfa-aviso" class="aviso"></div>
      </div>`
    : `<div class="pat-mfa">
        <p><strong>O Patrimônio exige a autenticação em dois fatores (MFA).</strong> Sua conta ainda não tem o autenticador configurado; sem ele o banco não libera os valores.</p>
        <button type="button" class="btn" id="btn-pat-mfa-config">Configurar o autenticador</button>
      </div>`;
  $("btn-pat-mfa-ok")?.addEventListener("click", () => comBotaoTravado("btn-pat-mfa-ok", patConfirmarMFA));
  $("pat-mfa-codigo")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); comBotaoTravado("btn-pat-mfa-ok", patConfirmarMFA); } });
  $("btn-pat-mfa-config")?.addEventListener("click", () => { if(typeof abrirModalMFA === "function") abrirModalMFA(); });
  $("pat-mfa-codigo")?.focus();
}
async function patConfirmarMFA(){
  const code = ($("pat-mfa-codigo")?.value || "").trim();
  if(!/^\d{6}$/.test(code)){ aviso("pat-mfa-aviso", "Digite os 6 dígitos exibidos no aplicativo autenticador.", "erro"); return; }
  try {
    const { data: fatores } = await sb.auth.mfa.listFactors();
    const totp = (fatores?.totp || []).find(f => f.status === "verified");
    if(!totp) throw new Error("Nenhum autenticador ativo nesta conta.");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if(error) throw error;
  } catch(err){
    aviso("pat-mfa-aviso", "Código não aceito: " + (err.message || "tente de novo"), "erro");
    return;
  }
  appLimparSujo();
  await carregarPatrimonio();
}

/* ---------- Carga ---------- */
async function carregarPatrimonio(){
  if(!podeVerPatrimonio()) return;
  const cont = $("pat-conteudo");
  if(!cont) return;
  const nivel = await patNivelSessao();
  if(!nivel || nivel.currentLevel !== "aal2"){ patMostrarPedidoMFA(nivel); return; }
  if(!_patCarregado) cont.innerHTML = `<p class="vazio">Carregando o patrimônio…</p>`;
  const [rb, ra, rr, rs, rf] = await Promise.all([
    sb.from("vw_pat_bens").select("*"),
    sb.from("patrimonio_avaliacoes").select("id,bem_tipo,bem_id,ano_referencia,valor,base,observacoes,avaliado_por,avaliado_em,updated_at,quantidade,valor_unitario,bem_rotulo")   // lote S54 (#172)
      .order("ano_referencia", { ascending: false }).range(0, 9999),
    sb.from("vw_pat_resumo").select("*"),
    sb.from("vw_pat_sem_valor").select("*"),
    sb.from("equipamentos").select("id,codigo,nome,tipo,titularidade,status").eq("ativo", true).neq("titularidade", "propria").order("codigo")
  ]);
  const erro = [rb, ra, rr, rs, rf].find(r => r.error);
  if(erro){
    cont.innerHTML = `<p class="vazio">Não foi possível carregar o patrimônio: ${esc(erro.error.message)}</p>`;
    return;
  }
  _patBens = rb.data || [];
  _patAval = ra.data || [];
  _patResumo = rr.data || [];
  _patSemValor = rs.data || [];
  _patFora = rf.data || [];
  /* índice: avaliação → bem (kit liga por qualquer peça do jogo, bem_ids) */
  const porId = new Map();
  _patAval.forEach(a => { const k = `${a.bem_tipo}:${a.bem_id}`; if(!porId.has(k)) porId.set(k, []); porId.get(k).push(a); });
  _patAvalPorBem = new Map();
  _patBens.forEach(b => {
    const lista = [];
    (b.bem_ids || [b.bem_id]).forEach(id => lista.push(...(porId.get(`${b.bem_tipo}:${id}`) || [])));
    lista.sort((x, y) => y.ano_referencia - x.ano_referencia || String(y.updated_at).localeCompare(String(x.updated_at)));
    _patAvalPorBem.set(patChave(b), lista);
  });
  const anos = patAnos();
  if(_patAno == null || !anos.includes(_patAno)) _patAno = patAnoPadrao();
  _patCarregado = true;
  preencherFiltrosPatrimonio();
  renderPatrimonio();
  // fase 98: saldo a executar dos imóveis em permuta (só se o módulo de permutas estiver carregado)
  if(typeof pmPatCarregar === "function") pmPatCarregar().then(() => { if(_patView === "avaliacao") renderPatrimonio(); }).catch(() => {});
}

/* ---------- Filtros ---------- */
function preencherFiltrosPatrimonio(){
  const selAno = $("pat-f-ano"), selGrp = $("pat-f-grupo");
  selAno.innerHTML = patAnos().map(a => `<option value="${esc(a)}">${a === patAnoPadrao() ? `Avaliação ${esc(a)} (vigente)` : `Avaliação ${esc(a)}`}</option>`).join("");
  selAno.value = String(_patAno);
  const grpAtual = selGrp.value;
  const presentes = new Set(_patBens.map(b => b.grupo));
  selGrp.innerHTML = `<option value="">Todos os grupos</option>` +
    PAT_GRUPOS.filter(([g]) => presentes.has(g)).map(([g, l]) => `<option value="${esc(g)}">${esc(l)}</option>`).join("");
  if(grpAtual && presentes.has(grpAtual)) selGrp.value = grpAtual;
}
function patFiltrados(){
  const termo = ($("pat-busca").value || "").trim().toLowerCase();
  const fGrp = $("pat-f-grupo").value;
  const soSem = $("pat-f-sem").checked;
  return _patBens.filter(b => {
    if(fGrp && b.grupo !== fGrp) return false;
    if(soSem && patValorNoAno(b, _patAno)) return false;
    if(termo){
      const alvo = [b.tag, b.descricao, b.numero_serie, b.placa, b.marca, b.modelo, patRotuloGrupo(b.grupo), b.grupo_contagem, b.tipo_acessorio, b.bem_rotulo_avaliado].filter(Boolean).join(" ").toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  }).sort((a, b) => patOrdemGrupo(a.grupo) - patOrdemGrupo(b.grupo) || patCompararTag(a, b));
}

/* ---------- Render: despachante + indicadores ---------- */
function renderPatrimonio(){
  if(!_patCarregado) return;
  document.querySelectorAll("#pat-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _patView));
  const tot = _patResumo.find(r => r.ano === _patAno && r.grupo === "total");
  $("pat-kpi-total").textContent = tot ? patBrlCurto(tot.total) : "—";
  $("pat-kpi-total").title = tot ? brl(tot.total) : "";
  $("pat-kpi-total-rot").textContent = `Patrimônio ${_patAno}`;
  $("pat-kpi-var").textContent = patVariacaoTexto(tot);
  $("pat-kpi-var-rot").textContent = `Contra ${_patAno - 1}`;
  $("pat-kpi-sem").textContent = tot ? String(tot.sem_valor) : "—";
  $("pat-kpi-sem-rot").textContent = `Sem valor em ${_patAno}`;
  $("pat-kpi-bens").textContent = tot ? String(tot.bens) : String(_patBens.length);
  $("btn-pat-novo").style.display = patPodeEditar() ? "" : "none";
  /* no Resumo só o ano vale; busca, grupo e "só sem valor" são da Avaliação */
  ["pat-busca", "pat-f-grupo", "pat-f-sem-rot"].forEach(id => { if($(id)) $(id).style.display = _patView === "avaliacao" ? "" : "none"; });
  if(_patView === "resumo") renderPatResumo();
  else renderPatAvaliacao(patFiltrados());
}

/* ---------- Render: Avaliação (a planilha, por grupo) ---------- */
function renderPatAvaliacao(dados){
  const cont = $("pat-conteudo");
  const ano = _patAno;
  $("pat-contador").textContent = `${dados.length} de ${_patBens.length}`;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum bem encontrado para os filtros.</p>`;
    return;
  }
  const edita = patPodeEditar();
  const grupos = [];
  dados.forEach(b => {
    let g = grupos[grupos.length - 1];
    if(!g || g.grupo !== b.grupo){ g = { grupo: b.grupo, bens: [] }; grupos.push(g); }
    g.bens.push(b);
  });
  let total = 0, semTotal = 0;
  const linhaBem = (b) => {
    const v = patValorNoAno(b, ano);
    const ult = v ? null : patUltimaAntes(b, ano);
    const detalhe = patDetalheBem(b);
    const obs = b.observacoes_cadastro ? String(b.observacoes_cadastro) : "";
    const modelo = patEhModelo(b);
    // lote S54 (#172): modelo de raiz mostra qtd × unitário, "N → M peças" quando a contagem mudou e a sugestão quando sem valor
    const mudou = v ? patQtdMudou(b, v.aval) : null;
    const valorHtml = v
      ? `${brl(v.valor)}${v.base === "fipe" && !v.aval ? '<div class="meta">FIPE do cadastro</div>' : ""}${modelo && v.aval && v.aval.valor_unitario != null ? `<div class="meta">${num(v.aval.quantidade)} × ${brl(v.aval.valor_unitario)}</div>` : ""}${mudou ? `<div class="meta txt-aviso" title="Peças contadas na avaliação → peças hoje. O valor do ano é o gravado; clique para regravar com a quantidade atual">${num(mudou.antes)} → ${num(mudou.agora)} peças</div>` : ""}`
      : `<span class="tag vermelho">sem valor</span>${ult ? `<div class="meta">último: ${brl(ult.valor)} (${esc(ult.ano_referencia)})</div>` : ""}${modelo && b.valor_sugerido != null ? `<div class="meta" title="Preço de referência do modelo (módulo Acessórios): só sugestão, nunca gravada sozinha">sugestão ${brl(b.valor_sugerido)}/peça</div>` : ""}`;
    const titulo = !edita ? "" : modelo ? `Clique para lançar o valor unitário por peça de ${ano} (total = ${num(b.quantidade || 0)} × unitário)` : `Clique para lançar o valor de ${ano}`;
    const html = `<tr class="linha-clicavel${v ? "" : " pat-sem-valor"}" data-k="${esc(patChave(b))}">
        <td><strong>${esc(b.tag || "—")}</strong></td>
        <td>${modelo ? `<span style="padding-left:16px;">${esc(b.descricao || "—")}</span>` : esc(b.descricao || "—")}${detalhe ? `<div class="meta"${modelo ? ' style="padding-left:16px;"' : ""}>${esc(detalhe)}</div>` : ""}${obs ? `<div class="meta" title="${esc(obs)}">${esc(obs.length > 110 ? obs.slice(0, 110) + "…" : obs)}</div>` : ""}</td>
        <td>${esc(b.ano || "—")}</td>
        <td class="meta">${esc(patSerieTexto(b) || "—")}</td>
        <td>${patEstadoHtml(b)}</td>
        <td class="num${edita ? " pat-editavel" : ""}" data-k="${esc(patChave(b))}"${titulo ? ` title="${esc(titulo)}"` : ""}>${valorHtml}</td>
        <td>${v ? esc(PAT_BASES[v.base] || v.base) : "—"}</td>
        <td class="num"${b.data_aquisicao ? ` title="Aquisição em ${esc(dataBR(b.data_aquisicao))}"` : ""}>${b.valor_aquisicao != null ? brl(b.valor_aquisicao) : "—"}</td>
      </tr>`;
    return { v, html };
  };
  /* sublinha de cabeçalho por grupo da Contagem Geral (CAMISAS, HASTES…) dentro de "Acessórios das raízes", com subtotal */
  const cabecalhoSub = (nome, n, pecas, sem, tot) => `<tr class="pat-grupo" title="Linha da Contagem Geral do módulo Acessórios (grupo de contagem do modelo)"><td colspan="5" style="padding-left:28px;"><em>${esc(nome)}</em>
        <span class="meta">· ${n} ${n === 1 ? "modelo" : "modelos"} · ${num(pecas)} ${pecas === 1 ? "peça" : "peças"}${sem ? ` · <span class="txt-perigo">${sem} sem valor</span>` : ""}</span></td>
      <td class="num"><strong>${brl(tot)}</strong></td><td colspan="2"></td></tr>`;
  const corpo = grupos.map(g => {
    let sub = 0, sem = 0;
    const partes = [];
    let subNome = null, subTot = 0, subSem = 0, subN = 0, subPecas = 0, subIdx = -1;
    const fecharSub = () => { if(subIdx >= 0) partes[subIdx] = cabecalhoSub(subNome, subN, subPecas, subSem, subTot); subNome = null; subIdx = -1; };
    g.bens.forEach(b => {
      if(patEhModelo(b)){
        const s = patSubgrupo(b);
        if(s !== subNome){ fecharSub(); subNome = s; subTot = 0; subSem = 0; subN = 0; subPecas = 0; subIdx = partes.length; partes.push(""); }
      } else if(subNome !== null) fecharSub();
      const r = linhaBem(b);
      if(r.v) sub += r.v.valor; else sem++;
      if(patEhModelo(b)){ subN++; subPecas += Number(b.quantidade || 0); if(r.v) subTot += r.v.valor; else subSem++; }
      partes.push(r.html);
    });
    fecharSub();
    total += sub; semTotal += sem;
    return `<tr class="pat-grupo"><td colspan="5"><strong>${esc(patRotuloGrupo(g.grupo))}</strong>
        <span class="meta">· ${g.bens.length} ${g.bens.length === 1 ? "bem" : "bens"}${sem ? ` · <span class="txt-perigo">${sem} sem valor</span>` : ""}</span></td>
      <td class="num"><strong>${brl(sub)}</strong></td><td colspan="2"></td></tr>${partes.join("")}`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table class="pat-tabela">
    <thead><tr>
      <th>TAG</th><th>Bem</th><th>Ano</th><th>Série / placa</th><th>Estado</th>
      <th class="num">Valor ${esc(ano)}</th><th>Base</th><th class="num" title="Custo histórico do cadastro (valor de aquisição): não entra no total">Aquisição</th>
    </tr></thead>
    <tbody>${corpo}</tbody>
    <tfoot><tr><td colspan="5"><strong>Total ${esc(ano)}${$("pat-busca").value || $("pat-f-grupo").value || $("pat-f-sem").checked ? " (filtro)" : ""}</strong>
      ${semTotal ? `<span class="meta">· ${semTotal} sem valor</span>` : ""}</td>
      <td class="num"><strong>${brl(total)}</strong></td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
}

/* clique no painel: célula de valor (diretor) edita na linha; o resto da linha abre a ficha do bem */
function patCliqueConteudo(e){
  const cel = e.target.closest(".pat-editavel");
  if(cel && patPodeEditar()){ e.stopPropagation(); patEditarInline(cel); return; }
  if(e.target.closest("input, button, a")) return;
  const tr = e.target.closest("tr.linha-clicavel[data-k]");
  if(tr) abrirPatrimonio(tr.dataset.k);
}

/* ---------- Edição do valor na célula (só diretor) ---------- */
function patEditarInline(td){
  if(td.querySelector("input")) return;
  const b = patBemPorChave(td.dataset.k);
  if(!b) return;
  const atual = patValorNoAno(b, _patAno);
  const modelo = patEhModelo(b);
  // lote S54 (#172): modelo de raiz edita o UNITÁRIO por peça (placeholder = sugestão); total = quantidade atual × unitário
  const ini = atual && atual.aval ? Number(modelo ? atual.aval.valor_unitario : atual.aval.valor) : null;
  const qtd = Number(b.quantidade || 0);
  const mudou = atual ? patQtdMudou(b, atual.aval) : null;
  const ph = modelo ? (b.valor_sugerido != null ? `sugestão ${Number(b.valor_sugerido)}` : "R$/peça") : `R$ ${_patAno}`;
  td.innerHTML = `<input type="number" class="pat-valor-input" step="0.01" min="0" value="${ini != null ? esc(ini) : ""}" placeholder="${esc(ph)}"${modelo ? ` title="Valor unitário por peça; total = ${num(qtd)} × unitário"` : ""} />${modelo ? `<div class="meta pat-inline-total">= ${brl(qtd * (ini || 0))}</div>` : ""}`;
  const inp = td.querySelector("input"), tot = td.querySelector(".pat-inline-total");
  if(tot) inp.addEventListener("input", () => { tot.textContent = `= ${brl(qtd * Number(inp.value || 0))}`; });
  inp.focus(); inp.select();
  let feito = false;
  const fim = async (gravar) => {
    if(feito) return;
    feito = true;
    const txt = inp.value.trim();
    // modelo com a contagem mudada regrava mesmo com o mesmo unitário (retrato novo: quantidade atual)
    if(!gravar || txt === "" || (ini != null && Number(txt) === ini && !mudou)){ appLimparSujo(); renderPatrimonio(); return; }
    const v = Number(txt);
    if(!Number.isFinite(v) || v < 0){ aviso("app-aviso", "Valor inválido: use um número maior ou igual a zero.", "erro"); renderPatrimonio(); return; }
    inp.disabled = true;
    const ok = await patGravarAvaliacao(b, _patAno, modelo ? { valor_unitario: v, quantidade: qtd, bem_rotulo: b.descricao } : { valor: v });
    appLimparSujo();
    if(ok) await carregarPatrimonio(); else renderPatrimonio();
  };
  inp.addEventListener("click", e => e.stopPropagation());
  inp.addEventListener("keydown", e => {
    if(e.key === "Enter"){ e.preventDefault(); fim(true); }
    else if(e.key === "Escape"){ e.preventDefault(); fim(false); }
  });
  inp.addEventListener("blur", () => fim(true));
}

/* grava (insere ou atualiza) a avaliação do bem no ano. Kit de trado: a do ano pode estar em qualquer peça do jogo. */
async function patGravarAvaliacao(b, ano, campos){
  if(!patPodeEditar()){ aviso("app-aviso", "Só o diretor lança valor no Patrimônio.", "erro"); return false; }
  const existente = patAvaliacoesDo(b).find(a => a.ano_referencia === ano);
  // lote S54 (#172): modelo de raiz grava unitário, quantidade (atual) e rótulo; o gatilho recalcula valor = qtd × unitário
  const modelo = patEhModelo(b);
  const base = {};
  if(modelo){
    const q = Number(campos.quantidade ?? b.quantidade ?? 0), u = Number(campos.valor_unitario);
    if(!Number.isFinite(u) || u < 0){ aviso("app-aviso", "Informe o valor unitário por peça.", "erro"); return false; }
    Object.assign(base, { valor_unitario: u, quantidade: q, bem_rotulo: campos.bem_rotulo || b.descricao || null, valor: Math.round(q * u * 100) / 100 });
  } else base.valor = campos.valor;
  let r;
  if(existente){
    const upd = { ...base };
    if(campos.base) upd.base = campos.base;
    if(campos.observacoes !== undefined) upd.observacoes = campos.observacoes;
    r = await sb.from("patrimonio_avaliacoes").update(upd).eq("id", existente.id).select("id");
  } else {
    r = await sb.from("patrimonio_avaliacoes").insert({
      bem_tipo: b.bem_tipo, bem_id: b.bem_id, ano_referencia: ano, ...base,
      base: campos.base || "mercado", observacoes: campos.observacoes || null
    }).select("id");
  }
  if(r.error){ aviso("app-aviso", "Não foi possível gravar a avaliação: " + r.error.message, "erro"); return false; }
  if(!r.data || !r.data.length){ aviso("app-aviso", "A avaliação não foi gravada: o banco exige o cargo diretor e a sessão com MFA.", "erro"); return false; }
  aviso("app-aviso", `Avaliação de ${ano} gravada (${b.tag || b.descricao}${modelo ? `: ${num(base.quantidade)} × ${brl(base.valor_unitario)} = ${brl(base.valor)}` : ""}).`, "ok");
  return true;
}

/* ---------- Render: Resumo ---------- */
function renderPatResumo(){
  const cont = $("pat-conteudo");
  const ano = _patAno;
  const linhas = _patResumo.filter(r => r.ano === ano && r.grupo !== "total")
    .sort((a, b) => patOrdemGrupo(a.grupo) - patOrdemGrupo(b.grupo));
  const tot = _patResumo.find(r => r.ano === ano && r.grupo === "total");
  $("pat-contador").textContent = `${linhas.length} grupos`;
  const cards = linhas.map(r => `
    <div class="ind ind-click" data-grupo="${esc(r.grupo)}" title="Ver os bens do grupo na Avaliação">
      <div class="num">${esc(patBrlCurto(r.total))}</div>
      <div class="rot">${esc(patRotuloGrupo(r.grupo))}</div>
      <div class="meta">${esc(r.bens)} ${r.bens === 1 ? "bem" : "bens"}${r.sem_valor ? ` · <span class="txt-perigo">${esc(r.sem_valor)} sem valor</span>` : ""}${r.variacao != null ? ` · ${esc(patVariacaoTexto(r))}` : ""}</div>
    </div>`).join("");
  const tabela = `<div class="tabela-rola"><table class="pat-tabela">
    <thead><tr><th>Grupo</th><th class="num">Bens</th><th class="num">Com valor</th><th class="num">Sem valor</th>
      <th class="num">Total ${esc(ano)}</th><th class="num">Total ${ano - 1}</th><th class="num">Variação</th></tr></thead>
    <tbody>${linhas.map(r => `<tr class="linha-clicavel" data-grupo="${esc(r.grupo)}">
      <td>${esc(patRotuloGrupo(r.grupo))}</td><td class="num">${esc(r.bens)}</td><td class="num">${esc(r.com_valor)}</td>
      <td class="num">${r.sem_valor ? `<span class="txt-perigo">${esc(r.sem_valor)}</span>` : "0"}</td>
      <td class="num">${brl(r.total)}</td><td class="num">${r.total_ano_anterior != null ? brl(r.total_ano_anterior) : "—"}</td>
      <td class="num">${esc(patVariacaoTexto(r))}</td></tr>`).join("")}</tbody>
    ${tot ? `<tfoot><tr><td><strong>Total geral</strong></td><td class="num"><strong>${esc(tot.bens)}</strong></td><td class="num">${esc(tot.com_valor)}</td>
      <td class="num">${esc(tot.sem_valor)}</td><td class="num"><strong>${brl(tot.total)}</strong></td>
      <td class="num">${tot.total_ano_anterior != null ? brl(tot.total_ano_anterior) : "—"}</td><td class="num">${esc(patVariacaoTexto(tot))}</td></tr></tfoot>` : ""}
  </table></div>`;
  const refSem = _patSemValor.length ? _patSemValor[0].ano_referencia : patAnoPadrao();
  const semValor = _patSemValor.slice().sort((a, b) => patOrdemGrupo(a.grupo) - patOrdemGrupo(b.grupo) || patCompararTag(a, b));
  const listaSem = semValor.length
    ? `<div class="tabela-rola"><table class="pat-tabela"><thead><tr><th>Grupo</th><th>TAG</th><th>Bem</th><th>Estado</th><th>Último valor</th></tr></thead><tbody>
        ${semValor.map(s => `<tr class="linha-clicavel" data-k="${esc(s.bem_tipo + ":" + s.bem_id)}">
          <td>${esc(patRotuloGrupo(s.grupo))}</td><td><strong>${esc(s.tag || "—")}</strong></td>
          <td>${esc(s.descricao || "—")}${s.observacoes_cadastro ? `<div class="meta">${esc(String(s.observacoes_cadastro).slice(0, 110))}</div>` : ""}</td>
          <td>${s.bem_tipo === "equipamento" ? tagStatus("equipamento", s.status) : s.bem_tipo === "acessorio_modelo" ? patEstadoHtml(s) : esc(s.status || "—")}</td>
          <td>${s.ultimo_valor != null ? `${brl(s.ultimo_valor)} <span class="meta">(${esc(s.ultimo_ano_avaliado)})</span>` : '<span class="tag vermelho">nunca avaliado</span>'}</td></tr>`).join("")}
      </tbody></table></div>`
    : `<p class="vazio">Todos os bens próprios ativos têm valor em ${esc(refSem)}.</p>`;
  const edita = patPodeEditar();
  const listaFora = _patFora.length
    ? `<div class="tabela-rola"><table class="pat-tabela"><thead><tr><th>TAG</th><th>Equipamento</th><th>Titularidade</th><th>Status</th>${edita ? "<th></th>" : ""}</tr></thead><tbody>
        ${_patFora.map(e => `<tr><td><strong>${linkEquipamento(e.id, e.codigo)}</strong></td><td>${esc(e.nome || "—")}</td>
          <td><span class="tag ambar">${esc(PAT_TIT_EQUIP[e.titularidade] || e.titularidade)}</span></td><td>${tagStatus("equipamento", e.status)}</td>
          ${edita ? `<td><button type="button" class="btn-sec pat-voltar-propria" data-id="${esc(e.id)}" data-codigo="${esc(e.codigo)}">Voltar a próprio</button></td>` : ""}</tr>`).join("")}
      </tbody></table></div>`
    : `<p class="vazio">Nenhum equipamento ativo marcado como locado ou de terceiro.</p>`;
  // lote S54 (#172): a verba única "Acessórios das raízes" (patrimonio_bens) continua até a diretoria retirá-la; com modelos
  // avaliados no mesmo ano ela conta em dobro
  const verbas = _patBens.filter(b => b.bem_tipo === "bem" && b.grupo === "acessorios_raiz");
  const modelosAvaliados = _patBens.filter(b => patEhModelo(b) && patValorNoAno(b, ano)).length;
  const avisoVerba = verbas.length && modelosAvaliados
    ? `<p class="texto-apoio compacto txt-aviso">Verba única ${verbas.map(v => `"${esc(v.descricao)}"`).join(", ")} ativa junto com ${modelosAvaliados} ${modelosAvaliados === 1 ? "modelo avaliado" : "modelos avaliados"} em ${esc(ano)}: retire-a (ficha do bem, "Retirar do patrimônio") para não contar em dobro.</p>`
    : "";
  cont.innerHTML = `
    <div class="indicadores pat-resumo-cards">${cards}</div>
    ${avisoVerba}
    <h3 class="titulo-bloco">Total por grupo — ${esc(ano)} × ${ano - 1}</h3>
    ${tabela}
    <h3 class="titulo-bloco">Sem valor em ${esc(refSem)} <span class="contador">${semValor.length}</span></h3>
    <p class="texto-apoio compacto">Pendência oficial: bem próprio ativo sem avaliação no ano de referência vigente (o maior ano já avaliado). Veículo com FIPE no cadastro não entra.</p>
    ${listaSem}
    <h3 class="titulo-bloco">Fora do patrimônio <span class="contador">${_patFora.length}</span></h3>
    <p class="texto-apoio compacto">Equipamentos ativos locados ou de terceiros: seguem normais na operação, mas não entram na avaliação, no total nem na lista "sem valor".</p>
    ${listaFora}`;
}
function patCliqueResumo(e){
  const btn = e.target.closest(".pat-voltar-propria");
  if(btn){ e.stopPropagation(); patDefinirTitularidade(btn.dataset.id, "propria", "voltou ao patrimônio pelo Resumo", btn.dataset.codigo); return true; }
  const g = e.target.closest("[data-grupo]");
  if(g && _patView === "resumo"){
    $("pat-f-grupo").value = g.dataset.grupo; $("pat-f-sem").checked = false; $("pat-busca").value = "";
    _patView = "avaliacao"; renderPatrimonio(); return true;
  }
  return false;
}

/* lote S54 (#172): o cadastro do modelo (descrição, medida, grupo de contagem, preço de referência) se edita no módulo
   Acessórios: abre a família raiz com a busca pela descrição do modelo (as peças dele aparecem no quadro) */
function patAbrirAcessoriosModelo(b){
  if(!b || !irParaSecao("acessorios")) return;
  const fam = document.querySelector('#ace-familias .serv-view-btn[data-familia="raiz"]');
  if(fam) fam.click();
  const busca = $("ace-busca");
  if(busca){
    busca.value = String(b.descricao || "").split(" · ")[0];
    busca.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/* ---------- Vendas: a visão é de Equipamentos (fase 96) ---------- */
function patIrParaVendas(){
  if(!irParaSecao("equipamentos")) return;
  const b = document.querySelector('#eqp-views .serv-view-btn[data-view="vendas"]');
  if(b) b.click();
  else aviso("app-aviso", "A visão Vendas de Equipamentos ainda não está publicada (fase 96).", "aviso");
}

/* ---------- Ficha do bem (avaliação, histórico, cadastro do bem avulso, titularidade) ---------- */
function mostrarPainelPat(){
  $("pat-painel").style.display = "";
  $("pat-ficha").style.display = "none";
  patEditKey = null;
}
function ativarTabPat(nome){
  document.querySelectorAll("#pat-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#pat-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
function patPreencherAvaliacaoDoAno(b){
  const ano = Number($("pat-aval-ano").value) || _patAno;
  const av = b ? patAvaliacoesDo(b).find(a => a.ano_referencia === ano) : null;
  const modelo = patEhModelo(b);
  $("pat-aval-valor").value = av ? Number(av.valor) : "";
  $("pat-aval-base").value = av ? av.base : "mercado";
  $("pat-aval-obs").value = av ? (av.observacoes || "") : "";
  // lote S54 (#172): modelo de raiz — quantidade (atual × avaliada) só leitura, unitário editável, total calculado, sugestão
  ["pat-aval-qtd-box", "pat-aval-unit-box", "pat-aval-sugestao"].forEach(id => { if($(id)) $(id).style.display = modelo ? "" : "none"; });
  if($("pat-aval-valor-rot")) $("pat-aval-valor-rot").textContent = modelo ? "Valor do ano (quantidade × unitário)" : "Valor de mercado (R$)";
  $("pat-aval-valor").disabled = modelo || !patPodeEditar();
  $("pat-aval-valor").placeholder = modelo ? "calculado" : "vazio = não mexe";
  if(modelo){
    const qtd = Number(b.quantidade || 0);
    $("pat-aval-qtd").value = `${num(qtd)}${av && av.quantidade != null ? ` × ${num(av.quantidade)} avaliada${Number(av.quantidade) !== qtd ? " (mudou)" : ""}` : " (sem avaliação no ano)"}`;
    $("pat-aval-unit").value = av && av.valor_unitario != null ? Number(av.valor_unitario) : "";
    $("pat-aval-unit").placeholder = b.valor_sugerido != null ? `sugestão ${Number(b.valor_sugerido)}` : "R$ por peça";
    const sug = [];
    if(b.valor_sugerido != null) sug.push(`preço de referência do modelo ${brl(b.valor_sugerido)}${b.sugestao_origem ? ` (${b.sugestao_origem}${b.sugestao_atualizada_em ? ", atualizado em " + dataBR(b.sugestao_atualizada_em) : ""})` : ""}`);
    if(b.custo_produto_sugerido != null) sug.push(`custo do produto ${b.produto_codigo_sugerido || ""}: ${brl(b.custo_produto_sugerido)}`);
    $("pat-aval-sugestao").textContent = sug.length ? `Sugestão: ${sug.join(" · ")}. É só referência (módulo Acessórios): o valor que vale é o unitário digitado aqui.` : "Sem preço de referência no cadastro do modelo (módulo Acessórios).";
  }
  const fipe = b && b.grupo === "veiculo" && b.valor_fipe != null;
  $("pat-aval-info").textContent = av
    ? (modelo && av.valor_unitario != null
        ? `Avaliação de ${ano}: ${num(av.quantidade)} × ${brl(av.valor_unitario)} = ${brl(av.valor)}, lançada em ${dataBR(av.avaliado_em)}${Number(av.quantidade) !== Number(b.quantidade || 0) ? `; hoje são ${num(b.quantidade || 0)} peças — salvar regrava com a quantidade atual` : ""}. O anterior fica no histórico.`
        : `Avaliação de ${ano} lançada em ${dataBR(av.avaliado_em)}. Mudar o valor guarda o anterior no histórico de alterações.`)
    : (fipe ? `Sem avaliação em ${ano}: vale a FIPE do cadastro (${brl(b.valor_fipe)}${b.fipe_referencia ? ", referência " + dataBR(b.fipe_referencia) : ""}). Lance um valor só se a diretoria discordar.`
            : `Sem avaliação em ${ano}.`);
  $("btn-pat-excluir-aval").style.display = av && patPodeEditar() ? "" : "none";
}
function patTravarFicha(){
  const edita = patPodeEditar();
  /* o ano fica livre para todos (o auditor navega pelos anos); o resto só o diretor muda */
  const modelo = patEhModelo(patEditKey && patEditKey !== "novo" ? patBemPorChave(patEditKey) : null);
  // lote S54 (#172): no modelo de raiz o valor do ano é calculado (quantidade × unitário): a célula fica travada para todos
  $("pat-ficha").querySelectorAll("input, select, textarea").forEach(el => { el.disabled = (!edita && el.id !== "pat-aval-ano") || (modelo && el.id === "pat-aval-valor"); });
  ["btn-salvar-pat", "btn-pat-tit-gravar"].forEach(id => { if($(id)) $(id).style.display = edita ? "" : "none"; });
}
function abrirPatrimonio(k){
  const b = patBemPorChave(k);
  if(!b){ aviso("app-aviso", "Bem fora do patrimônio ou não carregado.", "erro"); return; }
  patEditKey = k;
  $("pat-painel").style.display = "none";
  $("pat-ficha").style.display = "";
  $("pat-ficha-titulo").textContent = `${b.tag ? b.tag + " — " : ""}${b.descricao || ""}`;
  // lote S54 (#172): modelo de raiz mostra o grupo da Contagem Geral no chip do grupo
  $("pat-ficha-grupo").textContent = patRotuloGrupo(b.grupo) + (patEhModelo(b) ? ` · ${patSubgrupo(b)}` : "");
  $("pat-ficha-tag").textContent = b.tag || "—";
  $("pat-ficha-estado").innerHTML = patEstadoHtml(b);
  $("pat-ficha-vigente").textContent = b.valor_vigente != null ? brl(b.valor_vigente) : "sem valor";
  $("pat-ficha-vigente-rot").textContent = b.ano_avaliacao ? `Valor vigente (${b.ano_avaliacao})` : "Valor vigente";
  $("pat-ficha-base").textContent = b.base_vigente ? (PAT_BASES[b.base_vigente] || b.base_vigente) : "—";
  $("pat-ficha-aquisicao").textContent = b.valor_aquisicao != null ? brl(b.valor_aquisicao) : "—";
  $("pat-ficha-fipe-box").style.display = b.grupo === "veiculo" ? "" : "none";
  $("pat-ficha-fipe").textContent = b.valor_fipe != null ? brl(b.valor_fipe) : "—";
  $("pat-ficha-link").innerHTML = b.bem_tipo === "equipamento" ? linkEquipamento(b.bem_id, "Abrir o cadastro do equipamento")
    : b.bem_tipo === "acessorio" ? linkAcessorio(b.bem_id, "Abrir uma peça do kit")
    : patEhModelo(b) ? `<a href="#" class="pat-link-modelo" title="Módulo Acessórios, família raiz, busca pela descrição do modelo (o cadastro do modelo se edita lá)">Abrir Acessórios (raiz · modelo)</a>` : "";   // lote S54 (#172)
  /* abas: Cadastro do bem só para patrimonio_bens; Titularidade só para equipamento */
  $("pat-tab-bem-btn").style.display = b.bem_tipo === "bem" ? "" : "none";
  $("pat-tab-tit-btn").style.display = b.bem_tipo === "equipamento" ? "" : "none";
  $("btn-pat-retirar").style.display = b.bem_tipo === "bem" && patPodeEditar() ? "" : "none";
  $("pat-aval-ano").value = _patAno;
  patPreencherAvaliacaoDoAno(b);
  if(b.bem_tipo === "bem") patPreencherFormBem(b);
  if(b.bem_tipo === "equipamento"){ $("pat-tit-valor").value = "propria"; $("pat-tit-motivo").value = ""; }
  patTravarFicha();
  ativarTabPat("avaliacao");
  carregarHistoricoPat(b);
}
function novoBemPatrimonio(){
  if(!patPodeEditar()) return;
  patEditKey = "novo";
  $("pat-painel").style.display = "none";
  $("pat-ficha").style.display = "";
  $("pat-ficha-titulo").textContent = "Novo bem do patrimônio";
  ["pat-ficha-grupo", "pat-ficha-tag", "pat-ficha-vigente", "pat-ficha-base", "pat-ficha-aquisicao"].forEach(id => { $(id).textContent = "—"; });
  $("pat-ficha-estado").textContent = "—";
  $("pat-ficha-vigente-rot").textContent = "Valor vigente";
  $("pat-ficha-fipe-box").style.display = "none";
  $("pat-ficha-link").innerHTML = "";
  $("pat-tab-bem-btn").style.display = "";
  $("pat-tab-tit-btn").style.display = "none";
  $("btn-pat-retirar").style.display = "none";
  patPreencherFormBem(null);
  $("pat-aval-ano").value = _patAno || new Date().getFullYear();
  patPreencherAvaliacaoDoAno(null);
  $("pat-historico").innerHTML = `<p class="vazio">Bem novo: o histórico começa na primeira avaliação.</p>`;
  patTravarFicha();
  ativarTabPat("bem");
  $("pat-bem-nome").focus();
}
function patPreencherFormBem(b){
  $("pat-bem-nome").value = b ? (b.descricao || "") : "";
  $("pat-bem-grupo").value = b ? b.grupo : "imovel";
  $("pat-bem-tit").value = b ? (b.titularidade_bem || "") : "";
  $("pat-bem-matricula").value = b ? (b.numero_serie || "") : "";
  $("pat-bem-processo").value = b ? (b.placa || "") : "";
  $("pat-bem-unidade").value = b ? (b.unidade || "vb") : "m2";
  $("pat-bem-qtd").value = b && b.quantidade != null ? Number(b.quantidade) : 1;
  $("pat-bem-unit").value = b && b.valor_unitario != null ? Number(b.valor_unitario) : "";
  $("pat-bem-obs").value = b ? (b.observacoes_cadastro || "") : "";
}
function patLerFormBem(){
  const qtd = Number($("pat-bem-qtd").value);
  const unit = $("pat-bem-unit").value;
  return {
    nome: $("pat-bem-nome").value.trim(),
    grupo: $("pat-bem-grupo").value,
    titularidade: $("pat-bem-tit").value || null,
    matricula: $("pat-bem-matricula").value.trim() || null,
    processo: $("pat-bem-processo").value.trim() || null,
    unidade: $("pat-bem-unidade").value,
    quantidade: Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
    valor_unitario: unit !== "" ? Number(unit) : null,
    observacoes: $("pat-bem-obs").value.trim() || null
  };
}

async function salvarPatrimonio(){
  if(!patPodeEditar()){ aviso("app-aviso", "Só o diretor grava no Patrimônio.", "erro"); return; }
  const novo = patEditKey === "novo";
  let b = novo ? null : patBemPorChave(patEditKey);
  if(!novo && !b){ aviso("app-aviso", "Bem não encontrado; volte ao painel e abra de novo.", "erro"); return; }
  /* 1. cadastro do bem avulso (patrimonio_bens) */
  if(novo || b.bem_tipo === "bem"){
    const reg = patLerFormBem();
    if(!reg.nome){ aviso("app-aviso", "Informe o nome do bem.", "erro"); ativarTabPat("bem"); return; }
    if(reg.grupo === "imovel" && !reg.titularidade){ aviso("app-aviso", "Imóvel só entra no patrimônio em nome da empresa ou em processo de permuta: escolha a titularidade.", "erro"); ativarTabPat("bem"); return; }
    if(reg.valor_unitario != null && !(reg.valor_unitario >= 0)){ aviso("app-aviso", "Valor unitário inválido.", "erro"); ativarTabPat("bem"); return; }
    const r = novo
      ? await sb.from("patrimonio_bens").insert(reg).select("id")
      : await sb.from("patrimonio_bens").update(reg).eq("id", b.bem_id).select("id");
    if(r.error || !r.data || !r.data.length){ aviso("app-aviso", "Não foi possível gravar o bem: " + (r.error ? r.error.message : "sem permissão"), "erro"); return; }
    if(novo){
      const id = r.data[0].id;
      b = { bem_tipo: "bem", bem_id: id, bem_ids: [id], grupo: reg.grupo, tag: null, descricao: reg.nome };
      patEditKey = patChave(b);
    }
  }
  /* 2. avaliação do ano (valor vazio = não mexe na avaliação); modelo de raiz: unitário por peça (lote S54, #172) */
  const ano = Number($("pat-aval-ano").value);
  const modelo = patEhModelo(b);
  const txt = (modelo ? $("pat-aval-unit").value : $("pat-aval-valor").value).trim();
  if(txt !== ""){
    const valor = Number(txt);
    if(!Number.isInteger(ano) || ano < 2000 || ano > 2100){ aviso("app-aviso", "Ano de referência inválido.", "erro"); ativarTabPat("avaliacao"); return; }
    if(!Number.isFinite(valor) || valor < 0){ aviso("app-aviso", modelo ? "Valor unitário inválido." : "Valor inválido.", "erro"); ativarTabPat("avaliacao"); return; }
    const campos = modelo ? { valor_unitario: valor, quantidade: Number(b.quantidade || 0), bem_rotulo: b.descricao } : { valor };
    const ok = await patGravarAvaliacao(b, ano, { ...campos, base: $("pat-aval-base").value, observacoes: $("pat-aval-obs").value.trim() || null });
    if(!ok) return;
  } else if(modelo){
    aviso("app-aviso", "Informe o valor unitário por peça para gravar a avaliação do modelo.", "aviso");
    ativarTabPat("avaliacao");
    return;
  } else if(novo){
    aviso("app-aviso", "Bem gravado sem valor: ele aparece em \"sem valor\" até a avaliação do ano.", "ok");
  } else if(b.bem_tipo === "bem"){
    aviso("app-aviso", "Cadastro do bem gravado.", "ok");
  } else {
    aviso("app-aviso", "Informe o valor de mercado do ano para gravar a avaliação.", "aviso");
    ativarTabPat("avaliacao");
    return;
  }
  const chave = patEditKey;
  await carregarPatrimonio();
  if(patBemPorChave(chave)) abrirPatrimonio(chave); else mostrarPainelPat();
}

async function excluirAvaliacaoPat(){
  if(!patPodeEditar()) return;
  const b = patBemPorChave(patEditKey);
  const ano = Number($("pat-aval-ano").value);
  const av = b ? patAvaliacoesDo(b).find(a => a.ano_referencia === ano) : null;
  if(!av) return;
  if(!confirm(`Excluir a avaliação de ${ano} de ${b.tag || b.descricao}? A exclusão fica registrada no log.`)) return;
  const r = await sb.from("patrimonio_avaliacoes").delete().eq("id", av.id).select("id");
  if(r.error || !r.data || !r.data.length){ aviso("app-aviso", "Não foi possível excluir: " + (r.error ? r.error.message : "sem permissão"), "erro"); return; }
  aviso("app-aviso", `Avaliação de ${ano} excluída.`, "ok");
  const chave = patEditKey;
  await carregarPatrimonio();
  if(patBemPorChave(chave)) abrirPatrimonio(chave); else mostrarPainelPat();
}

async function retirarBemPat(){
  if(!patPodeEditar()) return;
  const b = patBemPorChave(patEditKey);
  if(!b || b.bem_tipo !== "bem") return;
  if(!confirm(`Retirar "${b.descricao}" do patrimônio? Ele sai da avaliação e do total; o histórico fica guardado.`)) return;
  const r = await sb.from("patrimonio_bens").update({ ativo: false }).eq("id", b.bem_id).select("id");
  if(r.error || !r.data || !r.data.length){ aviso("app-aviso", "Não foi possível retirar: " + (r.error ? r.error.message : "sem permissão"), "erro"); return; }
  aviso("app-aviso", `"${b.descricao}" retirado do patrimônio.`, "ok");
  mostrarPainelPat();
  await carregarPatrimonio();
}

/* titularidade do equipamento (propria | locada | terceiro) pela RPC, com motivo no log do equipamento */
async function patDefinirTitularidade(equipId, tit, motivo, rotulo){
  if(!patPodeEditar()) return;
  if(tit !== "propria" && !confirm(`Marcar ${rotulo || "o equipamento"} como ${PAT_TIT_EQUIP[tit].toLowerCase()}? Ele sai da avaliação, do total e da lista "sem valor" (a operação continua normal).`)) return;
  const { error } = await sb.rpc("patrimonio_definir_titularidade", { p_equipamento_id: equipId, p_titularidade: tit, p_motivo: motivo || null });
  if(error){ aviso("app-aviso", "Não foi possível mudar a titularidade: " + error.message, "erro"); return; }
  aviso("app-aviso", `Titularidade de ${rotulo || "equipamento"}: ${PAT_TIT_EQUIP[tit]}.`, "ok");
  const chave = patEditKey;
  await carregarPatrimonio();
  if(chave && patBemPorChave(chave)) abrirPatrimonio(chave); else mostrarPainelPat();
}
async function gravarTitularidadePat(){
  const b = patBemPorChave(patEditKey);
  if(!b || b.bem_tipo !== "equipamento") return;
  const tit = $("pat-tit-valor").value;
  const motivo = $("pat-tit-motivo").value.trim();
  if(tit === "propria"){ aviso("app-aviso", "O equipamento já é próprio.", "aviso"); return; }
  if(!motivo){ aviso("app-aviso", "Informe o motivo (quem é o dono, contrato de locação…).", "erro"); return; }
  await patDefinirTitularidade(b.bem_id, tit, motivo, b.tag);
}

/* histórico: avaliações por ano + alterações do valor (registros_log; só quem lê patrimônio enxerga) */
async function carregarHistoricoPat(b){
  const el = $("pat-historico");
  const avs = patAvaliacoesDo(b);
  el.innerHTML = `<p class="vazio">Carregando o histórico…</p>`;
  const ids = avs.map(a => a.id);
  const autores = [...new Set(avs.map(a => a.avaliado_por).filter(Boolean))];
  const [rl, rp, rt] = await Promise.all([
    ids.length ? sb.from("registros_log").select("registro_id,tipo,campo,valor_anterior,valor_novo,autor_nome,criado_em")
      .eq("entidade", "patrimonio_avaliacoes").in("registro_id", ids).order("criado_em", { ascending: false }).limit(200) : { data: [] },
    autores.length ? sb.from("profiles").select("id,nome").in("id", autores) : { data: [] },
    b.bem_tipo === "equipamento"
      ? sb.from("registros_log").select("tipo,campo,valor_anterior,valor_novo,autor_nome,criado_em").eq("entidade", "equipamentos").eq("registro_id", b.bem_id).eq("campo", "titularidade").order("criado_em", { ascending: false })
      : b.bem_tipo === "bem"
        ? sb.from("registros_log").select("tipo,campo,valor_anterior,valor_novo,autor_nome,criado_em").eq("entidade", "patrimonio_bens").eq("registro_id", b.bem_id).order("criado_em", { ascending: false }).limit(100)
        : { data: [] }
  ]);
  if(patEditKey !== patChave(b)) return;   // trocou de bem enquanto carregava
  const nomes = Object.fromEntries((rp.data || []).map(p => [p.id, p.nome]));
  const anoDe = Object.fromEntries(avs.map(a => [a.id, a.ano_referencia]));
  const tabAv = avs.length
    ? `<div class="tabela-rola"><table class="pat-tabela"><thead><tr><th>Ano</th><th class="num">Valor</th><th>Base</th><th>Lançada em</th><th>Por</th><th>Observações</th></tr></thead><tbody>
        ${avs.map(a => `<tr><td><strong>${esc(a.ano_referencia)}</strong></td><td class="num">${brl(a.valor)}${a.valor_unitario != null ? `<div class="meta" title="${esc(a.bem_rotulo || "")}">${num(a.quantidade)} × ${brl(a.valor_unitario)}</div>` : ""}</td><td>${esc(PAT_BASES[a.base] || a.base)}</td>
          <td>${esc(dataBR(a.avaliado_em))}</td><td>${esc(nomes[a.avaliado_por] || "—")}</td><td>${esc(a.observacoes || "")}</td></tr>`).join("")}
      </tbody></table></div>`
    : `<p class="vazio">Nenhuma avaliação lançada${b.grupo === "veiculo" && b.valor_fipe != null ? " (vale a FIPE do cadastro)" : ""}.</p>`;
  const fmtValor = (c, v) => ((c === "valor" || c === "valor_unitario") && v != null && v !== "" && !isNaN(Number(v))) ? brl(v) : (v ?? "");   // lote S54 (#172): unitário também em R$
  const logs = (rl.data || []).map(l => {
    const ano = anoDe[l.registro_id];
    const quando = l.criado_em ? `${dataBR(l.criado_em)} ${String(l.criado_em).slice(11, 16)}` : "";
    const oque = l.tipo === "criacao" ? `avaliação de ${ano ?? "?"} lançada`
      : `${ano ?? ""} · ${esc(l.campo || "")}: ${esc(fmtValor(l.campo, l.valor_anterior))} → ${esc(fmtValor(l.campo, l.valor_novo))}`;
    return `<li><span class="meta">${esc(quando)} · ${esc(l.autor_nome || "sistema")}</span> — ${/* html */ oque}</li>`;
  }).join("");
  const outros = (rt.data || []).map(l => {
    const quando = l.criado_em ? `${dataBR(l.criado_em)} ${String(l.criado_em).slice(11, 16)}` : "";
    const oque = l.tipo === "criacao" ? "cadastro criado" : l.tipo === "exclusao" ? "excluído"
      : `${esc(l.campo || "")}: ${esc(l.valor_anterior ?? "")} → ${esc(l.valor_novo ?? "")}`;
    return `<li><span class="meta">${esc(quando)} · ${esc(l.autor_nome || "sistema")}</span> — ${oque}</li>`;
  }).join("");
  el.innerHTML = `${tabAv}
    <h3 class="titulo-bloco">Alterações do valor</h3>
    ${logs ? `<ul class="pat-log">${logs}</ul>` : `<p class="vazio">Nenhuma alteração registrada.</p>`}
    ${b.bem_tipo !== "acessorio" ? `<h3 class="titulo-bloco">${b.bem_tipo === "equipamento" ? "Titularidade" : "Cadastro do bem"}</h3>
      ${outros ? `<ul class="pat-log">${outros}</ul>` : `<p class="vazio">Nada registrado.</p>`}` : ""}`;
}

/* ---------- Exportação .xlsx no leiaute da planilha (por grupo, ano escolhido) ---------- */
function exportarPatrimonio(){
  if(!_patCarregado || typeof XLSX === "undefined"){ aviso("app-aviso", "Carregue o patrimônio antes de exportar.", "erro"); return; }
  const ano = _patAno;
  const todos = _patBens.slice().sort((a, b) => patOrdemGrupo(a.grupo) - patOrdemGrupo(b.grupo) || patCompararTag(a, b));
  const aoa = [
    [`AVALIAÇÃO DOS BENS — ${ano}`],
    [`Valor de mercado na opinião da diretoria (veículos: FIPE do cadastro quando não avaliados). Gerado pelo app em ${dataBR(hojeISO())}.`],
    []
  ];
  let totalGeral = 0, grupoAtual = null, item = 0, sub = 0;
  const linhasUnitario = new Set();   /* linhas de bem avulso e de modelo de raiz: a coluna F é R$/m², verba ou R$/peça */
  /* lote S54 (#172): dentro de ACESSÓRIOS DAS RAÍZES, subtotal por grupo da Contagem Geral (CAMISAS, HASTES…) */
  let subNome = null, subTot = 0, subPecas = 0;
  const fecharSub = () => {
    if(subNome == null) return;
    aoa.push(["", subNome, `Subtotal ${subNome}`, subPecas, "", "", "", subTot]);
    subNome = null; subTot = 0; subPecas = 0;
  };
  const fecharGrupo = () => {
    if(grupoAtual == null) return;
    fecharSub();
    aoa.push(["", "", `Subtotal ${patRotuloGrupo(grupoAtual)}`, "", "", "", "", sub]);
    aoa.push([]);
  };
  todos.forEach(b => {
    if(b.grupo !== grupoAtual){
      fecharGrupo();
      grupoAtual = b.grupo; item = 0; sub = 0;
      aoa.push([patRotuloGrupo(b.grupo).toUpperCase()]);
      if(b.grupo === "trados_kits") aoa.push(["Item", "TAG", "Diâmetro (mm)", "Comprimento (m)", "Modelo", "Peças", "Estado", `Valor ${ano}`, "Base", "Observações"]);
      else if(b.grupo === "acessorios_raiz") aoa.push(["Item", "Grupo (Contagem Geral)", "Modelo / bem", "Peças / quantidade", "Unidade", "Valor unitário", "Titularidade", `Valor ${ano}`, "Base", "Observações"]);
      else if(b.bem_tipo === "bem") aoa.push(["Item", "", "Bem", "Quantidade", "Unidade", "Valor unitário", "Titularidade", `Valor ${ano}`, "Base", "Observações"]);
      else aoa.push(["Item", "TAG", "Máquina / Equipamento", "Modelo", "Marca", "Ano", "Série / placa", `Valor ${ano}`, "Base", "Observações"]);
    }
    item++;
    const v = patValorNoAno(b, ano);
    if(v){ sub += v.valor; totalGeral += v.valor; }
    const obs = (v && v.aval && v.aval.observacoes) || (v ? "" : "SEM VALOR");
    if(patEhModelo(b)){
      const s = patSubgrupo(b);
      if(s !== subNome){ fecharSub(); subNome = s; }
      if(v) subTot += v.valor;
      subPecas += Number(b.quantidade || 0);
      const mudou = v ? patQtdMudou(b, v.aval) : null;
      linhasUnitario.add(aoa.length);
      aoa.push([item, s, b.descricao || "", Number(b.quantidade || 0), "pç", v && v.aval && v.aval.valor_unitario != null ? Number(v.aval.valor_unitario) : "", "",
        v ? v.valor : "", v ? (PAT_BASES[v.base] || v.base) : "", [obs, mudou ? `avaliada com ${num(mudou.antes)} peças` : ""].filter(Boolean).join(" · ")]);
    } else if(b.grupo === "trados_kits"){
      aoa.push([item, b.tag || "", b.diametro_mm ?? "", b.comprimento_m != null ? Number(b.comprimento_m) : "", b.modelo || "", b.pecas ?? "",
        String(b.status || "").split(",").map(s => s.trim()).filter(Boolean).map(s => (STATUS.acessorio[s] || {}).label || s).join(", "), v ? v.valor : "", v ? (PAT_BASES[v.base] || v.base) : "", obs]);
    } else if(b.bem_tipo === "bem"){
      linhasUnitario.add(aoa.length);
      aoa.push([item, "", b.descricao || "", b.quantidade != null ? Number(b.quantidade) : "", PAT_UNIDADES[b.unidade] || b.unidade || "",
        b.valor_unitario != null ? Number(b.valor_unitario) : "", PAT_TIT_BEM[b.titularidade_bem] || "", v ? v.valor : "", v ? (PAT_BASES[v.base] || v.base) : "", obs]);
    } else {
      aoa.push([item, b.tag || "", b.descricao || "", b.modelo || "", b.marca || "", b.ano ?? "", patSerieTexto(b), v ? v.valor : "",
        v ? (PAT_BASES[v.base] || v.base) : "", obs]);
    }
  });
  fecharGrupo();
  aoa.push(["", "", "TOTAL GERAL", "", "", "", "", totalGeral]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 52 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 10 }, { wch: 40 }];
  /* valores em R$: coluna H em toda linha; F só nas linhas de bem avulso (valor unitário) */
  const rng = XLSX.utils.decode_range(ws["!ref"]);
  for(let r = 0; r <= rng.e.r; r++){
    const colunas = linhasUnitario.has(r) ? ["H", "F"] : ["H"];
    colunas.forEach(c => { const cel = ws[c + (r + 1)]; if(cel && typeof cel.v === "number") cel.z = '"R$" #,##0.00'; });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Avaliação ${ano}`);
  XLSX.writeFile(wb, `patrimonio-avaliacao-${ano}-${hojeISO()}.xlsx`);
}

/* ---------- Ligação dos eventos ---------- */
function ligarPatrimonio(){
  if(!$("sec-patrimonio")) return;
  document.querySelectorAll("#pat-views .serv-view-btn").forEach(b => b.addEventListener("click", () => {
    if(b.dataset.view === "vendas"){ patIrParaVendas(); return; }
    _patView = b.dataset.view;
    renderPatrimonio();
  }));
  $("pat-busca")?.addEventListener("input", debounce(renderPatrimonio, 150));
  $("pat-f-ano")?.addEventListener("change", () => { _patAno = Number($("pat-f-ano").value); renderPatrimonio(); });
  $("pat-f-grupo")?.addEventListener("change", renderPatrimonio);
  $("pat-f-sem")?.addEventListener("change", renderPatrimonio);
  $("pat-kpi-sem-card")?.addEventListener("click", () => {
    if(!_patCarregado) return;
    $("pat-f-sem").checked = true; $("pat-f-grupo").value = ""; $("pat-busca").value = "";
    _patView = "avaliacao"; renderPatrimonio();
  });
  $("pat-conteudo")?.addEventListener("click", (e) => {
    if(_patView === "resumo" && patCliqueResumo(e)) return;
    patCliqueConteudo(e);
  });
  $("btn-pat-exportar")?.addEventListener("click", exportarPatrimonio);
  $("btn-pat-novo")?.addEventListener("click", novoBemPatrimonio);
  $("btn-voltar-pat")?.addEventListener("click", mostrarPainelPat);
  $("btn-salvar-pat")?.addEventListener("click", () => comBotaoTravado("btn-salvar-pat", salvarPatrimonio));
  $("btn-pat-excluir-aval")?.addEventListener("click", () => comBotaoTravado("btn-pat-excluir-aval", excluirAvaliacaoPat));
  $("btn-pat-retirar")?.addEventListener("click", () => comBotaoTravado("btn-pat-retirar", retirarBemPat));
  $("btn-pat-tit-gravar")?.addEventListener("click", () => comBotaoTravado("btn-pat-tit-gravar", gravarTitularidadePat));
  $("pat-aval-ano")?.addEventListener("change", () => patPreencherAvaliacaoDoAno(patEditKey && patEditKey !== "novo" ? patBemPorChave(patEditKey) : null));
  // lote S54 (#172): unitário digitado na ficha mostra o total calculado; o link do modelo abre Acessórios (raiz) com a busca
  $("pat-aval-unit")?.addEventListener("input", () => {
    const b = patEditKey && patEditKey !== "novo" ? patBemPorChave(patEditKey) : null;
    if(!patEhModelo(b)) return;
    const txt = $("pat-aval-unit").value;
    $("pat-aval-valor").value = txt === "" ? "" : Math.round(Number(b.quantidade || 0) * Number(txt || 0) * 100) / 100;
  });
  $("pat-ficha-link")?.addEventListener("click", e => {
    const a = e.target.closest(".pat-link-modelo"); if(!a) return;
    e.preventDefault();
    patAbrirAcessoriosModelo(patEditKey && patEditKey !== "novo" ? patBemPorChave(patEditKey) : null);
  });
  document.querySelectorAll("#pat-notebook button").forEach(b => b.addEventListener("click", () => ativarTabPat(b.dataset.tab)));
  /* carga a cada abertura do menu (os valores mudam pouco, mas a ficha de outro módulo pode ter mudado o cadastro) */
  document.querySelector('nav button[data-secao="patrimonio"]')?.addEventListener("click", () => { mostrarPainelPat(); carregarPatrimonio(); });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarPatrimonio);
} else {
  ligarPatrimonio();
}

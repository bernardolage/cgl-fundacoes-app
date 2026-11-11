/* ====================================================================
   Módulo: marcar em sequência, por estaca e por bloco, na folha do projeto — fase 169b (continua o prefixo ppj-;
   funções ppjSeq*, mais ppjProximoNome e ppjArranjoBloco)
   Carregado depois de js/planta_posicoes.js, que chama este arquivo por ganchos guardados por typeof (ppjSeqPintar,
   ppjSeqFaixa, ppjSeqCliqueVazio, ppjSeqCliqueMarca, ppjSeqVisor e ppjSeqDesfazer). Sem este arquivo, a folha fica como na
   fase 167b. Tudo aqui vive dentro do modo de edição ("Editar posições"), só para quem edita estaca (ppjPodeEditar).
   O painel do modo de edição ganha três jeitos de posicionar:
   - Por estaca: o da 167b (estaca da vez), sem mudança.
   - Por bloco: a lista passa a ser dos blocos com estaca sem posição. Um clique no desenho mostra a prévia (as estacas do
     bloco em volta do ponto: em linha até 4, em anel acima disso) e pergunta; só "Posicionar" grava, todas de uma vez.
     "Desfazer" tira o bloco inteiro. Depois cada estaca pode ser arrastada, como qualquer outra.
   - Em sequência: cada clique propõe o próximo nome num campo preso ao ponto. Enter confirma; outro nome digitado troca
     e a sequência segue dele (ppjProximoNome: E09 → E10, B1.1 → B1.2, P12A → P13A). Se a estaca já existe naquele local e
     bloco, ela só é posicionada (se já está nesta folha, pergunta se move). Se não existe, é CRIADA: estaca prevista, com o
     tipo e o Ø da barra, e depois a posição. Se a posição falhar, a estaca criada neste passo é apagada. Nome que serve a
     mais de uma estaca (blocos diferentes, bloco em branco na barra) não grava: pede o bloco.
   - Antes da primeira estaca criada na sessão a tela avisa que ela entra na conta do avanço, e a faixa âmbar conta as
     estacas novas. "Desfazer" tira a posição e só apaga a estaca que foi criada nesta sessão, continua prevista, não tem
     execução vinculada e não está em outra folha.
   - "Definir bloco": Shift+clique junta estacas à seleção; o bloco digitado é gravado em estacas.bloco, uma a uma, depois
     de uma confirmação que lista as estacas (e avisa das já medidas). Nome repetido no bloco é dito por estaca e não
     derruba as outras.
   Nada é gravado em silêncio: criar estaca, mover, posicionar um bloco e definir bloco passam por um Enter ou um botão, e
   a recusa do banco aparece na caixa acima da folha, com o desenho como estava. Grava em public.estacas (policy
   estacas_write) e em public.estacas_planta_posicao (a da 167b), sempre com .select() para conferir a volta. Sem migration.
   As funções ppjProximoNome, ppjArranjoBloco, ppjSeqNorm, ppjSeqCandidatas, ppjSeqLinhaEstaca, ppjSeqBlocos,
   ppjSeqPodeApagar, ppjSeqPadroes, ppjSeqPrevias e as que montam HTML são puras (sem tela nem banco) e testadas por
   scripts/testar-fase169b.mjs.
   ==================================================================== */

const PPJ_SEQ_TABELA = "estacas";
const PPJ_SEQ_VIEW_EXEC = "vw_rdo_execucoes_obra";
/* as mesmas colunas que js/estacas.js lê ao abrir a obra: a estaca criada aqui entra na lista da aba sem reler tudo */
const PPJ_SEQ_COLUNAS = "id,numero,tipo,status,diametro_mm,profundidade_m,profundidade_executada_m,projeto_pendente,cota_topo,cota_ponta,volume_concreto_m3,data_execucao,equipamento_id,operador_id,observacoes,alterada_em,alteracao_motivo,bloco,ordem_execucao,coord_x,coord_y,local,refuro_motivo";
const PPJ_SEQ_BLOCO_MAX = 60;      // estacas posicionadas de uma vez por bloco
const PPJ_SEQ_SEL_MAX = 50;        // estacas por "Definir bloco"
const PPJ_SEQ_NOME_MAX = 40;
const PPJ_SEQ_DIAM_MIN = 50;       // Ø em mm
const PPJ_SEQ_DIAM_MAX = 3000;
const PPJ_SEQ_LISTA_MAX = 300;
const PPJ_SEQ_SEP = "\u0001";      // separa local e bloco na chave de um bloco
const PPJ_SEQ_TIPOS = { helice_continua: "Hélice contínua", raiz: "Raiz", escavada: "Escavada", secante: "Hélice secante", outro: "Outro" };   // só se js/estacas.js não trouxer a tabela dele

/* ---------- regra (pura) ---------- */
/* o mesmo formato do cadastro: maiúsculas, sem espaço nas pontas, um espaço só no meio */
function ppjSeqNorm(s){ return String(s ?? "").toUpperCase().trim().replace(/\s+/g, " "); }
const ppjSeqTxt = (s) => String(s ?? "").trim();
/* como a estaca é dita numa lista: o nome e, quando tem, o bloco (em obra numerada por bloco o nome sozinho não diz qual é) */
const ppjSeqRotuloEstaca = (e) => (ppjSeqNorm(e && e.numero) || "(sem nº)") + (ppjSeqTxt(e && e.bloco) ? ` (${ppjSeqTxt(e.bloco)})` : "");
/* O próximo nome da sequência: soma `passo` no ÚLTIMO número do nome e preserva o resto (prefixo, zeros à esquerda e
   sufixo). E09 → E10, E099 → E100, B1.1 → B1.2, P12A → P13A. BB1.1 e B1.1 continuam nomes diferentes (BB1.2 e B1.2).
   Nome sem número, ou conta que daria negativo, volta como veio: a pessoa digita o próximo. */
function ppjProximoNome(nome, passo){
  const txt = ppjSeqNorm(nome), p = Math.trunc(Number(passo));
  const m = /^(.*?)(\d+)(\D*)$/.exec(txt);
  if(!m || !Number.isFinite(p) || !p) return txt;
  const n = Number(m[2]) + p;
  if(!Number.isSafeInteger(n) || n < 0) return txt;
  return m[1] + String(n).padStart(m[2].length, "0") + m[3];
}
/* Onde ficam as n estacas de um bloco em volta do ponto clicado, em pixels de tela: [{ dx, dy }]. Até 4, em linha;
   acima disso, em anel. Entre os centros de duas vizinhas há um marcador e meio (2 × raio de marcador, mais um raio de
   folga), então nenhuma cobre a outra. */
function ppjArranjoBloco(n, raio){
  const q = Math.max(0, Math.trunc(Number(n) || 0)), r = Number(raio) > 0 ? Number(raio) : 8, passo = 3 * r;
  if(!q) return [];
  if(q <= 4) return Array.from({ length: q }, (_, i) => ({ dx: (i - (q - 1) / 2) * passo, dy: 0 }));
  const R = passo / (2 * Math.sin(Math.PI / q));
  return Array.from({ length: q }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / q; return { dx: R * Math.cos(a), dy: R * Math.sin(a) }; });
}
/* Quem é a estaca de nome `numero` neste local e bloco? o = { local, bloco, numero }.
   - bloco preenchido: a estaca daquele (local, bloco, número), que é o índice único do banco;
   - bloco em branco: qualquer estaca do local com aquele número. Uma só: é ela. Mais de uma: ambígua, não grava.
   Devolve { tipo: "nova" } | { tipo: "existe", estaca } | { tipo: "ambigua", blocos: [...] }. */
function ppjSeqCandidatas(estacas, o){
  const p = o || {}, numero = ppjSeqNorm(p.numero), local = ppjSeqTxt(p.local), bloco = ppjSeqTxt(p.bloco);
  const doLocal = (Array.isArray(estacas) ? estacas : []).filter(e => e && ppjSeqNorm(e.numero) === numero && ppjSeqTxt(e.local) === local);
  const c = bloco ? doLocal.filter(e => ppjSeqTxt(e.bloco) === bloco) : doLocal;
  if(!c.length) return { tipo: "nova" };
  if(c.length === 1) return { tipo: "existe", estaca: c[0] };
  return { tipo: "ambigua", blocos: [...new Set(c.map(e => ppjSeqTxt(e.bloco) || "(sem bloco)"))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })) };
}
/* A linha de uma estaca nova. o = { obraId, numero, tipo, diametro, local, bloco, hoje, tipos: [valores aceitos] }.
   Nasce PREVISTA (o padrão do banco é executada, por isso o status vai escrito). Devolve { linha } ou { erro }. */
function ppjSeqLinhaEstaca(o){
  const p = o || {}, numero = ppjSeqNorm(p.numero), tipo = String(p.tipo || ""), d = Number(p.diametro);
  if(!PPJ_UUID_RE.test(String(p.obraId || ""))) return { erro: "Obra inválida." };
  if(!numero) return { erro: "Digite o nome da estaca." };
  if(numero.length > PPJ_SEQ_NOME_MAX) return { erro: `O nome da estaca tem no máximo ${PPJ_SEQ_NOME_MAX} letras.` };
  if(!tipo || !(Array.isArray(p.tipos) ? p.tipos : Object.keys(PPJ_SEQ_TIPOS)).includes(tipo)) return { erro: "Para criar a estaca, escolha o tipo na barra ao lado." };
  if(p.diametro === "" || p.diametro === null || p.diametro === undefined || !Number.isFinite(d) || d < PPJ_SEQ_DIAM_MIN || d > PPJ_SEQ_DIAM_MAX)
    return { erro: `Para criar a estaca, informe o Ø em milímetros na barra ao lado (de ${PPJ_SEQ_DIAM_MIN} a ${PPJ_SEQ_DIAM_MAX}).` };
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(p.hoje || "")) ? String(p.hoje).split("-").reverse().join("/") : "";
  return { linha: { obra_id: p.obraId, numero, tipo, status: "prevista", diametro_mm: d, local: ppjSeqTxt(p.local) || null, bloco: ppjSeqTxt(p.bloco) || null,
    observacoes: `Marcada pelo desenho do projeto${data ? " em " + data : ""}.` } };
}
/* Os blocos que têm estaca sem posição nesta folha. o = { local: o da folha, todas, termo }. Bloco é (local, bloco): o
   mesmo nome de bloco em dois locais são dois blocos. Estaca sem bloco não entra (essa é "por estaca").
   Devolve [{ chave, local, bloco, estacas: as sem posição, em ordem natural, total: estacas do bloco }]. */
function ppjSeqBlocos(estacas, mapa, o){
  const p = o || {}, local = ppjSeqTxt(p.local), termo = ppjSeqTxt(p.termo).toLowerCase(), grupos = new Map();
  const tem = (id) => !!mapa && typeof mapa.has === "function" && mapa.has(id);
  for(const e of Array.isArray(estacas) ? estacas : []){
    const bloco = e ? ppjSeqTxt(e.bloco) : "", loc = e ? ppjSeqTxt(e.local) : "";
    if(!bloco || (!p.todas && local && loc !== local)) continue;
    const chave = loc + PPJ_SEQ_SEP + bloco;
    if(!grupos.has(chave)) grupos.set(chave, { chave, local: loc, bloco, estacas: [], total: 0 });
    const g = grupos.get(chave);
    g.total++;
    if(!tem(e.id)) g.estacas.push(e);
  }
  return [...grupos.values()].filter(g => g.estacas.length && (!termo || `${g.bloco} ${g.local}`.toLowerCase().includes(termo)))
    .map(g => ({ ...g, estacas: ppjPosOrdenar(g.estacas) }))
    .sort((a, b) => ppjPosCompararNomes(a.bloco, b.bloco) || a.local.localeCompare(b.local, "pt-BR", { numeric: true }));
}
/* Desfazer só apaga a estaca que foi criada nesta sessão pelo assistente, continua prevista, não tem execução vinculada
   e não está posicionada em outra folha. o = { estaca: como está no banco agora, novas: ids criados nesta sessão,
   temExecucao, emOutraFolha }. Devolve { apaga: true } ou { apaga: false, motivo }. */
function ppjSeqPodeApagar(o){
  const p = o || {}, e = p.estaca;
  if(!e || !e.id) return { apaga: false, motivo: "a estaca não foi encontrada no banco" };
  if(!(Array.isArray(p.novas) ? p.novas : []).includes(e.id)) return { apaga: false, motivo: "ela não foi criada nesta sessão" };
  if(e.status !== "prevista") return { apaga: false, motivo: "ela já não está prevista" };
  if(p.temExecucao) return { apaga: false, motivo: "ela já tem execução vinculada" };
  if(p.emOutraFolha) return { apaga: false, motivo: "ela está posicionada em outra folha" };
  return { apaga: true };
}
/* Tipo e Ø que a barra propõe para estaca nova: os mais comuns da obra (vazios em obra sem estaca) */
function ppjSeqPadroes(estacas){
  const l = (Array.isArray(estacas) ? estacas : []).filter(Boolean);
  const maisComum = (vals) => { const m = new Map(); vals.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; };
  const tipo = maisComum(l.map(e => e.tipo).filter(Boolean)), t = tipo ? tipo[0] : "";
  const diam = maisComum(l.filter(e => e.tipo === t).map(e => Number(e.diametro_mm)).filter(d => d > 0));
  return { tipo: t, diametro: diam ? String(diam[0]) : "" };
}
/* A prévia de um bloco: onde cada estaca ficaria, em fração da folha. centro = ponto do palco clicado; v = visor.
   Estaca que cairia fora da folha para na borda. Devolve [{ estaca_id, x, y }], ou nulo se o centro está fora da folha. */
function ppjSeqPrevias(lista, centro, v, lw, lh){
  const l = Array.isArray(lista) ? lista : [];
  if(!centro || !ppjPosFracao(v, centro.x, centro.y, lw, lh)) return null;
  const arranjo = ppjArranjoBloco(l.length, PPJ_POS_RAIO);
  return l.map((e, i) => { const f = ppjPosFracao(v, centro.x + arranjo[i].dx, centro.y + arranjo[i].dy, lw, lh, true); return { estaca_id: e.id, x: f.x, y: f.y }; });
}
const ppjSeqRotuloBloco = () => (typeof rotuloAgrupamento === "function" ? String(rotuloAgrupamento() || "Bloco") : "Bloco");
function ppjSeqMensagem(erro, oQue){
  if(!erro) return `${oQue}: o banco não devolveu a linha gravada. Seu cargo pode não alterar estacas nesta obra. Nada foi gravado.`;
  const cod = String(erro.code || ""), msg = String(erro.message || erro);
  if(cod === "23505" || /duplicate key|unique constraint/i.test(msg)) return `${oQue}: já existe estaca com esse nome nesse local e bloco. Nada foi gravado.`;
  if(typeof ehErroDePermissao === "function" && ehErroDePermissao(erro)) return `${oQue}: seu cargo não altera estacas nesta obra. Nada foi gravado.`;
  return `${oQue}: ${msg.replace(/[.\s]+$/, "")}. Nada foi gravado.`;
}

/* ---------- HTML (puro) ---------- */
function ppjSeqModosHTML(modo){
  const b = (v, texto, dica) => `<button type="button" class="serv-view-btn${modo === v ? " ativo" : ""}" data-ppj-seq-modo="${esc(v)}" aria-pressed="${modo === v ? "true" : "false"}" title="${esc(dica)}">${esc(texto)}</button>`;
  return b("estaca", "Por estaca", "Um clique posiciona a estaca da vez") + b("bloco", "Por bloco", "Um clique posiciona todas as estacas do bloco da vez, depois de você confirmar")
    + b("sequencia", "Em sequência", "Cada clique propõe o próximo nome. Estaca que ainda não existe é criada, depois de você confirmar");
}
/* s = { proximo, passo, bloco, tipo, diametro, local, localFixo: o da folha, locais, blocos, tipos: [[valor, rótulo]], rotuloBloco }.
   A barra do modo "Em sequência". */
function ppjSeqFormHTML(s){
  const p = s || {}, rot = String(p.rotuloBloco || "Bloco");
  const local = p.localFixo ? `<p class="ppj-seq-fixo"><span class="rotulo-caps">Local</span> ${esc(p.localFixo)} (o da folha)</p>`
    : (p.locais || []).length ? `<div class="campo"><label for="ppj-seq-local">Local</label><select id="ppj-seq-local" title="O local das estacas marcadas nesta folha"><option value="">Sem local</option>${(p.locais || []).map(l => `<option value="${esc(l)}"${l === p.local ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>` : "";
  return `<div class="ppj-seq-form">
      <div class="campo"><label for="ppj-seq-proximo">Próximo nome</label><input id="ppj-seq-proximo" value="${esc(p.proximo || "")}" maxlength="${PPJ_SEQ_NOME_MAX}" placeholder="ex.: E01" autocomplete="off" title="O nome proposto no próximo clique. Depois de cada estaca confirmada o número anda sozinho." /></div>
      <div class="campo"><label for="ppj-seq-passo">Passo</label><input id="ppj-seq-passo" type="number" step="1" value="${esc(p.passo ?? 1)}" title="Quanto o número anda a cada estaca: 1 para E01, E02, E03; 2 para E01, E03, E05" /></div>
      ${/* html */ local}
      <div class="campo"><label for="ppj-seq-bloco">${esc(rot)} (opcional)</label><input id="ppj-seq-bloco" value="${esc(p.bloco || "")}" maxlength="60" list="ppj-seq-blocos-dl" autocomplete="off" title="O ${esc(rot.toLowerCase())} das estacas marcadas agora. Em obra numerada por ${esc(rot.toLowerCase())}, o mesmo nome existe em vários: sem ele o sistema não sabe qual é." /><datalist id="ppj-seq-blocos-dl">${(p.blocos || []).map(b => `<option value="${esc(b)}"></option>`).join("")}</datalist></div>
      <div class="campo"><label for="ppj-seq-tipo">Tipo (estaca nova)</label><select id="ppj-seq-tipo" title="O tipo das estacas que forem criadas pelo desenho"><option value="">Escolha…</option>${(p.tipos || []).map(t => `<option value="${esc(t[0])}"${t[0] === p.tipo ? " selected" : ""}>${esc(t[1])}</option>`).join("")}</select></div>
      <div class="campo"><label for="ppj-seq-diam">Ø em mm (estaca nova)</label><input id="ppj-seq-diam" type="number" min="${PPJ_SEQ_DIAM_MIN}" max="${PPJ_SEQ_DIAM_MAX}" step="10" value="${esc(p.diametro || "")}" title="O diâmetro das estacas que forem criadas pelo desenho, em milímetros" /></div>
      <p class="ppj-seq-dica">Clique no desenho, confira o nome e aperte Enter. A estaca que já existe é só posicionada; a que não existe é criada como prevista.</p>
    </div>`;
}
/* a lista "por bloco": clicar faz do bloco o da vez */
function ppjSeqBlocosHTML(lista, daVez, buscando, rotuloBloco){
  const l = Array.isArray(lista) ? lista : [], rot = String(rotuloBloco || "Bloco").toLowerCase();
  if(!l.length) return uiVazio(buscando ? `Nenhum ${rot} com esse nome tem estaca sem posição.` : `Nenhum ${rot} com estaca sem posição nesta folha. Estaca sem ${rot} é posicionada "Por estaca".`);
  return l.slice(0, PPJ_SEQ_LISTA_MAX).map(g => `<div class="ppj-item${g.chave === daVez ? " ativo" : ""}" role="button" tabindex="0" data-ppj-seq-bloco="${esc(g.chave)}" aria-pressed="${g.chave === daVez ? "true" : "false"}" title="Clique para fazer deste o ${esc(rot)} da vez"><span class="ppj-item-nome">${esc(g.bloco)}</span><span class="ppj-item-sub">${esc([g.local, `${g.estacas.length} de ${g.total} sem posição`].filter(Boolean).join(" · "))}</span></div>`).join("")
    + (l.length > PPJ_SEQ_LISTA_MAX ? `<p class="ppj-item-mais">e mais ${l.length - PPJ_SEQ_LISTA_MAX}: use a busca para achar.</p>` : "");
}
/* A caixa presa ao ponto clicado. p = { etapa: "nome" | "mover" | "aviso" | "bloco", nome, msg, ocupado, previstas,
   quantas, bloco, rotuloBloco }. Nada é gravado antes do botão (ou do Enter no campo do nome). */
function ppjSeqCaixaHTML(p){
  const c = p || {}, msg = c.msg ? `<p class="ppj-seq-msg" role="alert">${esc(c.msg)}</p>` : "";
  const cancelar = `<button type="button" class="btn-sec btn-sm" data-ppj-seq="cancelar" title="Não gravar nada neste ponto (Esc)"${c.ocupado ? " disabled" : ""}>Cancelar</button>`;
  if(c.etapa === "bloco"){
    const rot = String(c.rotuloBloco || "bloco").toLowerCase();
    return `<p class="ppj-seq-pergunta">Posicionar ${Number(c.quantas) === 1 ? "a estaca" : `as ${Number(c.quantas) || 0} estacas`} do ${esc(rot)} ${/* html */ uiCodigo(c.bloco || "")} aqui?</p>${/* html */ msg}
      <div class="ppj-seq-acoes"><button type="button" class="btn btn-sm" data-ppj-seq="ok" id="ppj-seq-ok" title="Gravar a posição das estacas deste ${esc(rot)}, como na prévia"${c.ocupado ? " disabled" : ""}>${c.ocupado ? "Gravando…" : "Posicionar"}</button>${/* html */ cancelar}</div>`;
  }
  if(c.etapa === "mover") return `<p class="ppj-seq-pergunta">${/* html */ uiCodigo(c.nome || "")} já está nesta folha. Mover para cá?</p>${/* html */ msg}
      <div class="ppj-seq-acoes"><button type="button" class="btn btn-sm" data-ppj-seq="ok" id="ppj-seq-ok" title="Mover a estaca para este ponto"${c.ocupado ? " disabled" : ""}>${c.ocupado ? "Gravando…" : "Mover"}</button>${/* html */ cancelar}</div>`;
  if(c.etapa === "aviso") return `<p class="ppj-seq-pergunta">Criar a estaca ${/* html */ uiCodigo(c.nome || "")}?</p>
      <p class="ppj-seq-alerta">Esta obra tem ${Math.max(0, Math.trunc(Number(c.previstas) || 0))} estacas previstas. Cada estaca marcada aqui entra na conta do avanço.</p>${/* html */ msg}
      <div class="ppj-seq-acoes"><button type="button" class="btn btn-sm" data-ppj-seq="ok" id="ppj-seq-ok" title="Criar a estaca como prevista e gravar a posição dela"${c.ocupado ? " disabled" : ""}>${c.ocupado ? "Gravando…" : "Criar estaca"}</button>${/* html */ cancelar}</div>`;
  return `<label class="rotulo-caps" for="ppj-seq-nome">Estaca neste ponto</label>
      <input id="ppj-seq-nome" value="${esc(c.nome || "")}" maxlength="${PPJ_SEQ_NOME_MAX}" autocomplete="off" aria-label="Nome da estaca neste ponto" title="Enter confirma. Digite outro nome para trocar: a sequência segue dele."${c.ocupado ? " disabled" : ""} />${/* html */ msg}
      <div class="ppj-seq-acoes"><button type="button" class="btn btn-sm" data-ppj-seq="ok" id="ppj-seq-ok" title="Confirmar o nome (Enter)"${c.ocupado ? " disabled" : ""}>${c.ocupado ? "Gravando…" : "Confirmar"}</button>${/* html */ cancelar}</div>`;
}
/* s = { nomes: nomes das selecionadas, bloco, definir: { bloco, medidas: quantas já medidas | null (não deu para conferir) | undefined (ainda lendo), ocupado },
         resultado: { ok, falhas: [{ nome, motivo }] }, rotuloBloco, limite }. O bloco "Definir bloco" do painel. */
function ppjSeqSelecaoHTML(s){
  const p = s || {}, nomes = Array.isArray(p.nomes) ? p.nomes : [], rot = String(p.rotuloBloco || "Bloco"), rotMin = rot.toLowerCase();
  const res = p.resultado ? `<p class="${p.resultado.falhas && p.resultado.falhas.length ? "ppj-seq-alerta" : "ppj-seq-ok"}" role="status">${esc(`${Number(p.resultado.ok) || 0} ${Number(p.resultado.ok) === 1 ? "estaca gravada" : "estacas gravadas"}.`)}${(p.resultado.falhas || []).map(f => ` ${esc(f.nome)}: ${esc(f.motivo)}.`).join("")}</p>` : "";
  if(!nomes.length) return `${/* html */ res}<p class="ppj-seq-dica">Shift+clique nas estacas do desenho para selecionar várias e definir o ${esc(rotMin)} delas.</p>`;
  const lista = nomes.slice(0, 12).join(", ") + (nomes.length > 12 ? ` e mais ${nomes.length - 12}` : "");
  if(p.definir){
    const d = p.definir, espera = d.medidas === undefined, med = d.medidas === null ? `<p class="ppj-seq-alerta">Não foi possível conferir se alguma já entrou em medição.</p>` : Number(d.medidas) > 0 ? `<p class="ppj-seq-alerta">${Number(d.medidas)} ${Number(d.medidas) === 1 ? "delas já entrou" : "delas já entraram"} em medição.</p>` : "";
    return `<div class="ppj-seq-confirma" role="group" aria-label="Confirmar o ${esc(rotMin)}"><p class="ppj-seq-pergunta">Gravar o ${esc(rotMin)} ${/* html */ uiCodigo(d.bloco || "")} em ${nomes.length === 1 ? "1 estaca" : `${nomes.length} estacas`}?</p>
      <p class="ppj-seq-dica">${esc(lista)}</p>${/* html */ med}
      <div class="ppj-seq-acoes"><button type="button" class="btn btn-sm" data-ppj-seq="definir-ok" title="Gravar o ${esc(rotMin)} nas estacas selecionadas, uma a uma"${d.ocupado || espera ? " disabled" : ""}>${d.ocupado ? "Gravando…" : espera ? "Conferindo a medição…" : `Gravar ${esc(rotMin)}`}</button>
      <button type="button" class="btn-sec btn-sm" data-ppj-seq="definir-cancelar" title="Não gravar o ${esc(rotMin)}"${d.ocupado ? " disabled" : ""}>Cancelar</button></div></div>`;
  }
  const passou = nomes.length > (Number(p.limite) || PPJ_SEQ_SEL_MAX);
  return `${/* html */ res}<p class="ppj-seq-sel-txt"><strong>${nomes.length === 1 ? "1 selecionada" : `${nomes.length} selecionadas`}</strong>: ${esc(lista)}</p>
    ${passou ? `<p class="ppj-seq-alerta">No máximo ${Number(p.limite) || PPJ_SEQ_SEL_MAX} estacas de cada vez.</p>` : ""}
    <div class="campo"><label for="ppj-seq-bloco-novo">${esc(rot)} das selecionadas</label><input id="ppj-seq-bloco-novo" value="${esc(p.bloco || "")}" maxlength="60" list="ppj-seq-blocos-dl2" autocomplete="off" /><datalist id="ppj-seq-blocos-dl2">${(p.blocos || []).map(b => `<option value="${esc(b)}"></option>`).join("")}</datalist></div>
    <div class="ppj-seq-acoes"><button type="button" class="btn-sec btn-sm" data-ppj-seq="definir" title="Conferir e gravar o ${esc(rotMin)} das estacas selecionadas"${passou ? " disabled" : ""}>Definir ${esc(rotMin)}</button>
    <button type="button" class="btn-sec btn-sm" data-ppj-seq="limpar-sel" title="Tirar todas da seleção">Limpar seleção</button></div>`;
}

/* ====================================================================
   Tela
   ==================================================================== */
function ppjSeqEstadoNovo(obraId){
  return { obraId: obraId || null, modo: "estaca", proximo: "", passo: 1, local: "", bloco: "", tipo: "", diametro: "", padroes: false,
    pendente: null, avisou: false, novas: [], ocupado: false, blocoDaVez: null, termoBloco: "", previa: null,
    selecao: new Set(), blocoNovo: "", definir: null, resultado: null, medidas: null, msgForm: "",
    nos: null, chaves: {}, plantaId: null };
}
let _ppjSeq = ppjSeqEstadoNovo(null);   // trocado inteiro a cada obra: os contadores valem para a sessão naquela obra

function ppjSeqEstado(){
  const obraId = _ppj.obraId || null;
  if(_ppjSeq.obraId !== obraId){ ppjSeqSoltarNos(_ppjSeq); _ppjSeq = ppjSeqEstadoNovo(obraId); }
  return _ppjSeq;
}
function ppjSeqSoltarNos(q){
  if(q.nos) for(const n of Object.values(q.nos)) if(n && n.remove) n.remove();
  q.nos = null; q.chaves = {};
}
const ppjSeqLista = () => (typeof _estacas !== "undefined" && Array.isArray(_estacas) ? _estacas : null);
const ppjSeqLocal = (st, q) => st.local || q.local || "";
const ppjSeqPrevistas = () => { const l = ppjEstacas(); return l.length - l.filter(e => e.status === "refugada").length; };
function ppjSeqTipos(){
  const tabela = typeof ESTACA_TIPOS !== "undefined" && ESTACA_TIPOS ? ESTACA_TIPOS : PPJ_SEQ_TIPOS;
  const valores = typeof tiposEstacaDisponiveis === "function" ? tiposEstacaDisponiveis() : Object.keys(tabela);
  return valores.map(t => [t, String(tabela[t] || t)]);
}
const ppjSeqRepintar = () => { if(_ppjPos.disponivel) ppjPosPintar(_ppjPos); };
/* uma gravação por vez, na mesma fila das gravações da 167b: nada passa na frente de uma posição que ainda está indo */
function ppjSeqNaFila(st, fn){
  st.pendentes++;
  const p = st.fila.then(fn).finally(() => { st.pendentes--; });
  st.fila = p.catch(e => console.error("Marcar em sequência, fila de gravação:", e));
  return p;
}
function ppjSeqEmpilhar(st, acao){ st.pilha = st.pilha.concat(acao).slice(-PPJ_POS_DESFAZER_MAX); }
function ppjSeqCancelar(q){ q.pendente = null; q.previa = null; }

/* ---------- ganchos de js/planta_posicoes.js ---------- */
/* a faixa âmbar do modo de edição: o que o clique faz neste modo, e quantas estacas novas nesta sessão */
function ppjSeqFaixa(st){
  const q = ppjSeqEstado();
  if(!st || !st.editando) return null;
  const rot = ppjSeqRotuloBloco().toLowerCase();
  const instrucao = q.modo === "sequencia" ? "Clique no desenho: o próximo nome aparece preso ao ponto. Enter confirma; a estaca que ainda não existe é criada como prevista. Arraste um marcador para mover."
    : q.modo === "bloco" ? `Clique no desenho para ver onde ficam as estacas do ${rot} da vez; só o botão Posicionar grava. Arraste um marcador para mover.` : "";
  const nota = q.novas.length ? `${q.novas.length} ${q.novas.length === 1 ? "estaca nova" : "estacas novas"} nesta sessão` : "";
  return { instrucao, nota };
}
/* clique num ponto vazio do desenho, no modo de edição. Devolve true quando este módulo ficou com o clique. */
function ppjSeqCliqueVazio(st, ponto){
  const q = ppjSeqEstado();
  if(!st.editando || !ppjPodeEditar() || q.modo === "estaca") return false;
  if(q.ocupado) return true;
  const t = ppjTamanho();
  if(!t || !_ppj.visor) return true;
  const f = ppjPosFracao(_ppj.visor, ponto.x, ponto.y, t.lw, t.lh);
  if(!f){ if(q.pendente || q.previa){ ppjSeqCancelar(q); ppjSeqRepintar(); } return true; }   // fora da folha
  ppjPosAvisar("");
  q.resultado = null;
  if(q.modo === "sequencia"){
    const nome = ppjSeqNorm(q.proximo);
    if(!nome){ q.msgForm = "Digite o próximo nome na barra ao lado (ex.: E01) antes de clicar no desenho."; ppjSeqCancelar(q); ppjSeqRepintar(); return true; }
    q.msgForm = "";
    q.previa = null;
    q.pendente = { etapa: "nome", x: f.x, y: f.y, nome, msg: "" };
    ppjSeqRepintar();
    return true;
  }
  // por bloco: a prévia das estacas do bloco da vez em volta do ponto
  const bloco = ppjSeqBlocos(ppjEstacas(), st.mapa, { local: st.local, todas: st.todas }).find(g => g.chave === q.blocoDaVez);
  if(!bloco) return true;
  if(bloco.estacas.length > PPJ_SEQ_BLOCO_MAX){
    ppjPosAvisar(`O ${ppjSeqRotuloBloco().toLowerCase()} ${bloco.bloco} tem ${bloco.estacas.length} estacas sem posição: no máximo ${PPJ_SEQ_BLOCO_MAX} de cada vez. Posicione este "Por estaca".`);
    return true;
  }
  const itens = ppjSeqPrevias(bloco.estacas, ponto, _ppj.visor, t.lw, t.lh);
  if(!itens) return true;
  q.previa = { chave: bloco.chave, bloco: bloco.bloco, itens, nomes: bloco.estacas.map(e => ppjSeqNorm(e.numero)) };
  q.pendente = { etapa: "bloco", x: f.x, y: f.y, msg: "" };
  ppjSeqRepintar();
  return true;
}
/* clique num marcador, no modo de edição. Shift+clique junta (ou tira) a estaca da seleção de "Definir bloco".
   Devolve true quando este módulo ficou com o clique. */
function ppjSeqCliqueMarca(st, id, ev){
  const q = ppjSeqEstado();
  if(!st.editando || !ppjPodeEditar() || q.ocupado) return false;
  if(!ev || !ev.shiftKey){
    if(q.selecao.size || q.definir){ q.selecao = new Set(); q.definir = null; ppjSeqRepintar(); }
    return false;
  }
  const s = new Set(q.selecao);
  if(st.selecionada && !s.size) s.add(st.selecionada);   // a que já estava selecionada pelo clique simples entra junto
  if(s.has(id)) s.delete(id); else s.add(id);
  q.selecao = s; q.definir = null; q.resultado = null;
  st.selecionada = null;
  ppjSeqRepintar();
  return true;
}
/* o visor mexeu (zoom, arrasto): a caixa e a prévia acompanham o ponto */
function ppjSeqVisor(st){
  const q = _ppjSeq;
  if(q.pendente || q.previa) ppjSeqColocar(st, q);
}
/* depois de a folha ser pintada: os três modos no painel, a caixa presa ao ponto, a prévia e a seleção */
function ppjSeqPintar(st){
  const q = ppjSeqEstado();
  if(!st || !st.editando || !st.disponivel || !ppjPodeEditar()){
    if(q.nos || q.pendente || q.selecao.size || q.modo !== "estaca"){
      ppjSeqSoltarNos(q); ppjSeqCancelar(q);
      q.selecao = new Set(); q.definir = null; q.resultado = null; q.modo = "estaca"; q.msgForm = "";
      const painel = $("ppj-painel");
      if(painel) painel.classList.remove("ppj-seq-outro-modo");
      if(st && st.marcas) for(const no of st.marcas.values()) no.classList.remove("ppj-seq-sel");
    }
    return;
  }
  if(q.plantaId !== st.plantaId){ ppjSeqSoltarNos(q); ppjSeqCancelar(q); q.selecao = new Set(); q.definir = null; q.blocoDaVez = null; q.plantaId = st.plantaId; }
  ppjSeqPainel(st, q);
  ppjSeqCaixa(st, q);
  for(const [id, no] of st.marcas) no.classList.toggle("ppj-seq-sel", q.selecao.has(id));
}

/* ---------- painel ---------- */
function ppjSeqNo(tag, id, classe){
  const n = document.createElement(tag);
  n.setAttribute("id", id);
  if(classe) n.setAttribute("class", classe);
  return n;
}
function ppjSeqPainel(st, q){
  const painel = $("ppj-painel");
  if(!painel) return;
  if(!q.nos || q.nos.modos.parentNode !== painel){
    ppjSeqSoltarNos(q);
    const modos = ppjSeqNo("div", "ppj-seq-modos", "serv-views ppj-seq-modos"), corpo = ppjSeqNo("div", "ppj-seq-corpo", "ppj-seq-corpo"), sel = ppjSeqNo("div", "ppj-seq-selecao", "ppj-seq-selecao");
    modos.setAttribute("role", "group");
    modos.setAttribute("aria-label", "Como posicionar");
    painel.insertBefore(modos, painel.firstChild || null);
    painel.appendChild(corpo);
    painel.appendChild(sel);
    q.nos = { modos, corpo, sel, caixa: null, previa: null };
  }
  if(!q.padroes){ const d = ppjSeqPadroes(ppjEstacas()); q.tipo = q.tipo || d.tipo; q.diametro = q.diametro || d.diametro; q.padroes = true; }
  painel.classList.toggle("ppj-seq-outro-modo", q.modo !== "estaca");
  const pinta = (no, chave, html) => { if(q.chaves[chave] !== html){ no.innerHTML = html; q.chaves[chave] = html; return true; } return false; };
  pinta(q.nos.modos, "modos", ppjSeqModosHTML(q.modo));
  const estacas = ppjEstacas(), rot = ppjSeqRotuloBloco();
  const blocosObra = [...new Set(estacas.map(e => ppjSeqTxt(e.bloco)).filter(Boolean))].sort((a, b) => ppjPosCompararNomes(a, b));
  if(q.modo === "sequencia"){
    // a barra só é refeita quando muda o que não é digitado (listas e modo): o que a pessoa digita fica no campo
    const fixo = JSON.stringify(["seq", st.local, ppjLocaisDaObra(estacas), blocosObra, ppjSeqTipos(), rot]);
    if(q.chaves.corpoFixo !== fixo){
      q.nos.corpo.innerHTML = ppjSeqFormHTML({ proximo: q.proximo, passo: q.passo, bloco: q.bloco, tipo: q.tipo, diametro: q.diametro, local: q.local, localFixo: st.local,
        locais: ppjLocaisDaObra(estacas), blocos: blocosObra, tipos: ppjSeqTipos(), rotuloBloco: rot }) + `<p class="ppj-seq-msg" id="ppj-seq-form-msg" role="alert"></p>`;
      q.chaves.corpoFixo = fixo; q.chaves.corpo = null;
    }
    const campo = $("ppj-seq-proximo"), msg = $("ppj-seq-form-msg");
    if(campo && campo.value !== q.proximo && (typeof document === "undefined" || document.activeElement !== campo)) campo.value = q.proximo;
    if(msg) msg.textContent = q.msgForm || "";
  } else if(q.modo === "bloco"){
    q.chaves.corpoFixo = null;
    const todos = ppjSeqBlocos(estacas, st.mapa, { local: st.local, todas: st.todas }), lista = q.termoBloco ? ppjSeqBlocos(estacas, st.mapa, { local: st.local, todas: st.todas, termo: q.termoBloco }) : todos;
    if(!lista.some(g => g.chave === q.blocoDaVez)){ q.blocoDaVez = lista.length ? lista[0].chave : null; if(q.previa){ ppjSeqCancelar(q); } }
    const daVez = lista.find(g => g.chave === q.blocoDaVez);
    if(q.chaves.corpo !== "bloco"){
      q.nos.corpo.innerHTML = `<div class="rotulo-caps" id="ppj-seq-bloco-conta"></div><p class="ppj-ed-vez" id="ppj-seq-bloco-vez"></p><input id="ppj-seq-bloco-busca" type="search" placeholder="Buscar ${esc(rot.toLowerCase())}…" aria-label="Buscar ${esc(rot.toLowerCase())} com estaca sem posição" autocomplete="off" /><div class="ppj-lista" id="ppj-seq-bloco-lista" role="group" aria-label="${esc(rot)}s com estaca sem posição nesta folha"></div>`;
      q.chaves.corpo = "bloco"; q.chaves.blocos = null;
      const busca = $("ppj-seq-bloco-busca");
      if(busca) busca.value = q.termoBloco;
    }
    const vez = $("ppj-seq-bloco-vez"), alvo = $("ppj-seq-bloco-lista"), conta = $("ppj-seq-bloco-conta");   // contador próprio: o "Sem posição nesta folha (N)" da 167b continua acima, contando estacas
    if(vez) vez.textContent = daVez ? `${rot} da vez: ${daVez.bloco} (${daVez.estacas.length} ${daVez.estacas.length === 1 ? "estaca" : "estacas"})` : `Nenhum ${rot.toLowerCase()} para posicionar.`;
    const html = ppjSeqBlocosHTML(lista, q.blocoDaVez, !!q.termoBloco && todos.length > 0, rot);
    if(alvo && q.chaves.blocos !== html){ alvo.innerHTML = html; q.chaves.blocos = html; }
    if(conta) conta.textContent = `${rot}s com estaca sem posição (${todos.length})`;
  } else {
    q.chaves.corpoFixo = null;
    pinta(q.nos.corpo, "corpo", "");
  }
  const nomes = [...q.selecao].map(id => estacas.find(e => e.id === id)).filter(Boolean).map(ppjSeqRotuloEstaca);
  const definir = q.definir ? { bloco: q.definir.bloco, ocupado: q.definir.ocupado, medidas: q.medidas === null ? undefined : q.medidas === false ? null : [...q.selecao].filter(id => q.medidas.has(id)).length } : null;
  // o campo do bloco das selecionadas só é refeito quando a seleção ou a etapa mudam, para não perder o que foi digitado
  const chaveSel = JSON.stringify([nomes, definir, q.resultado, rot]);
  if(q.chaves.sel !== chaveSel){
    q.nos.sel.innerHTML = ppjSeqSelecaoHTML({ nomes, bloco: q.blocoNovo, blocos: blocosObra, definir, resultado: q.resultado, rotuloBloco: rot, limite: PPJ_SEQ_SEL_MAX });
    q.chaves.sel = chaveSel;
  }
}

/* ---------- caixa presa ao ponto e prévia ---------- */
function ppjSeqCaixa(st, q){
  const palco = $("ppj-palco");
  if(!palco || !q.nos) return;
  if(!q.pendente){
    if(q.nos.caixa){ q.nos.caixa.remove(); q.nos.caixa = null; q.chaves.caixa = null; }
    if(q.nos.previa){ q.nos.previa.remove(); q.nos.previa = null; q.chaves.previa = null; }
    return;
  }
  if(!q.nos.caixa || q.nos.caixa.parentNode !== palco){
    const c = ppjSeqNo("div", "ppj-seq-caixa", "ppj-seq-caixa");
    c.setAttribute("role", "group");
    c.setAttribute("aria-label", "Confirmar neste ponto");
    c.setAttribute("tabindex", "-1");
    // o que acontece dentro da caixa não arrasta a folha nem vale como clique no desenho
    for(const tipo of ["pointerdown", "pointerup", "wheel", "dblclick"]) c.addEventListener(tipo, (ev) => ev.stopPropagation());
    palco.appendChild(c);
    q.nos.caixa = c; q.chaves.caixa = null;
  }
  const p = q.pendente, rot = ppjSeqRotuloBloco();
  const html = ppjSeqCaixaHTML({ etapa: p.etapa, nome: p.nome, msg: p.msg, ocupado: q.ocupado, previstas: ppjSeqPrevistas(), quantas: q.previa ? q.previa.itens.length : 0, bloco: q.previa ? q.previa.bloco : "", rotuloBloco: rot });
  if(q.chaves.caixa !== html){
    q.nos.caixa.innerHTML = html; q.chaves.caixa = html;
    /* foco: o campo do nome recebe o cursor; o botão do bloco recebe o foco (a prévia veio de um clique do mouse). "Mover" e
       "Criar estaca" chegam por um Enter: o foco vai para a caixa, não para o botão, para um Enter segurado não confirmar sozinho. */
    const campo = p.etapa === "nome" ? $("ppj-seq-nome") : p.etapa === "bloco" ? $("ppj-seq-ok") : q.nos.caixa;
    if(campo && !q.ocupado){
      if(p.etapa === "nome") campo.value = p.nome;
      if(campo.focus) campo.focus({ preventScroll: true });
      if(p.etapa === "nome" && !p.msg && campo.select) campo.select();
    }
  }
  // prévia: o ponto da estaca (ou as estacas do bloco), tracejado, por baixo da caixa
  const itens = q.previa ? q.previa.itens.map((i, k) => ({ x: i.x, y: i.y, nome: q.previa.nomes[k] })) : [{ x: p.x, y: p.y, nome: "" }];
  const chavePrevia = JSON.stringify(itens);
  if(st.svg && (!q.nos.previa || q.nos.previa.parentNode !== st.svg)){
    const g = document.createElementNS(PPJ_POS_NS, "g");
    g.setAttribute("id", "ppj-seq-previa");
    g.setAttribute("class", "ppj-seq-previa");
    st.svg.appendChild(g);
    q.nos.previa = g; q.chaves.previa = null;
  }
  if(q.nos.previa && q.chaves.previa !== chavePrevia){
    q.nos.previa.replaceChildren(...itens.map(i => {
      const no = document.createElementNS(PPJ_POS_NS, "g"), c = document.createElementNS(PPJ_POS_NS, "circle"), t = document.createElementNS(PPJ_POS_NS, "text");
      no.setAttribute("class", "ppj-seq-fantasma");
      c.setAttribute("r", String(PPJ_POS_RAIO));
      t.setAttribute("class", "ppj-marca-rot ppj-seq-fantasma-rot");
      t.setAttribute("x", String(PPJ_POS_RAIO + 4));
      t.setAttribute("y", "4");
      t.textContent = i.nome;
      no.appendChild(c); no.appendChild(t);
      no.ppjFracao = { x: i.x, y: i.y };
      return no;
    }));
    q.chaves.previa = chavePrevia;
  }
  ppjSeqColocar(st, q);
}
/* põe a caixa e a prévia no ponto, com o zoom e o arrasto de agora */
function ppjSeqColocar(st, q){
  const t = ppjTamanho(), v = _ppj.visor, p = q.pendente;
  if(!t || !v || !q.nos) return;
  if(q.nos.previa){
    q.nos.previa.setAttribute("transform", `translate(${v.tx}, ${v.ty})`);
    for(const no of Array.from(q.nos.previa.children)) if(no.ppjFracao) no.setAttribute("transform", `translate(${no.ppjFracao.x * t.lw * v.z}, ${no.ppjFracao.y * t.lh * v.z})`);
  }
  if(q.nos.caixa && p){
    const tela = ppjPosTela(v, p.x, p.y, t.lw, t.lh);
    if(!tela) return;
    // a caixa fica abaixo e à direita do ponto, sem sair do palco (a altura muda com a etapa: mede a que está na tela)
    const largura = q.nos.caixa.offsetWidth || 230, altura = q.nos.caixa.offsetHeight || 130;
    const x = Math.max(4, Math.min(t.W - largura - 4, tela.x + 14)), y = Math.max(4, Math.min(t.H - altura - 4, tela.y + 14));
    q.nos.caixa.style.left = x + "px";
    q.nos.caixa.style.top = y + "px";
  }
}

/* ---------- ações do modo "Em sequência" ---------- */
/* Enter (ou Confirmar) no nome: decide o que o ponto vira. Só a estaca que já existe e ainda não está na folha é
   posicionada direto; mover e criar passam por mais uma confirmação (criar, só na primeira da sessão). */
function ppjSeqConfirmarNome(st, q){
  const p = q.pendente, campo = $("ppj-seq-nome");
  if(!p || p.etapa !== "nome" || q.ocupado) return;
  const nome = ppjSeqNorm(campo ? campo.value : p.nome);
  p.nome = nome;
  if(!nome){ p.msg = "Digite o nome da estaca."; ppjSeqRepintar(); return; }
  if(nome.length > PPJ_SEQ_NOME_MAX){ p.msg = `O nome tem no máximo ${PPJ_SEQ_NOME_MAX} letras.`; ppjSeqRepintar(); return; }
  const local = ppjSeqLocal(st, q), rot = ppjSeqRotuloBloco().toLowerCase();
  const c = ppjSeqCandidatas(ppjEstacas(), { local, bloco: q.bloco, numero: nome });
  if(c.tipo === "ambigua"){
    p.msg = `${nome} existe em ${c.blocos.length} ${rot}s${local ? ` de ${local}` : ""} (${c.blocos.slice(0, 6).join(", ")}${c.blocos.length > 6 ? "…" : ""}). Escolha o ${rot} na barra ao lado. Nada foi gravado.`;
    ppjSeqRepintar();
    return;
  }
  if(c.tipo === "existe"){
    p.estacaId = c.estaca.id;
    if(st.mapa.has(c.estaca.id)){ p.etapa = "mover"; p.msg = ""; ppjSeqRepintar(); return; }
    ppjSeqAvancar(q, nome);
    ppjPosFazer(st, { tipo: "posicionar", estaca_id: c.estaca.id, depois: { x: p.x, y: p.y } });   // a posição de sempre: aparece na hora, grava e, se o banco recusar, volta
    return;
  }
  // estaca nova: confere tipo e Ø antes de perguntar
  const linha = ppjSeqLinhaNova(st, q, nome);
  if(linha.erro){ p.msg = linha.erro; ppjSeqRepintar(); return; }
  if(!q.avisou){ p.etapa = "aviso"; p.msg = ""; ppjSeqRepintar(); return; }
  ppjSeqCriar(st, q);
}
function ppjSeqLinhaNova(st, q, nome){
  return ppjSeqLinhaEstaca({ obraId: st.obraId, numero: nome, tipo: q.tipo, diametro: q.diametro, local: ppjSeqLocal(st, q), bloco: q.bloco,
    hoje: typeof hojeISO === "function" ? hojeISO() : "", tipos: ppjSeqTipos().map(t => t[0]) });
}
/* a sequência segue do nome confirmado */
function ppjSeqAvancar(q, nome){
  q.proximo = ppjProximoNome(nome, q.passo);
  ppjSeqCancelar(q);
}
/* o botão da caixa, conforme a etapa */
function ppjSeqOk(st, q){
  const p = q.pendente;
  if(!p || q.ocupado || !st.editando || !ppjPodeEditar()) return;
  if(p.etapa === "nome") return ppjSeqConfirmarNome(st, q);
  if(p.etapa === "mover"){
    const antes = st.mapa.get(p.estacaId);
    if(!antes){ ppjSeqCancelar(q); ppjSeqRepintar(); return; }
    ppjSeqAvancar(q, p.nome);
    ppjPosFazer(st, { tipo: "mover", estaca_id: p.estacaId, antes, depois: { x: p.x, y: p.y } });
    return;
  }
  if(p.etapa === "aviso"){ q.avisou = true; return ppjSeqCriar(st, q); }
  if(p.etapa === "bloco") return ppjSeqPosicionarBloco(st, q);
}
/* Cria a estaca e a posição dela, nessa ordem. Se a posição falhar, a estaca criada neste passo é apagada. Só depois de
   as duas gravações voltarem a estaca aparece no desenho. */
function ppjSeqCriar(st, q){
  const p = q.pendente;
  if(!p || q.ocupado || !st.editando || !ppjPodeEditar()) return;
  const nome = p.nome, reg = ppjSeqLinhaNova(st, q, nome);
  if(reg.erro){ p.etapa = "nome"; p.msg = reg.erro; ppjSeqRepintar(); return; }
  if(ppjSeqCandidatas(ppjEstacas(), { local: reg.linha.local, bloco: reg.linha.bloco, numero: nome }).tipo !== "nova"){ p.etapa = "nome"; p.msg = ""; return ppjSeqConfirmarNome(st, q); }
  q.ocupado = true;
  ppjPosAvisar("");
  ppjSeqRepintar();
  const falhou = (msg) => { q.ocupado = false; if(q.pendente === p){ p.etapa = "nome"; p.msg = "Não foi gravada. O motivo está no aviso acima da folha."; } ppjPosAvisar(msg); aviso("app-aviso", msg, "erro"); ppjSeqRepintar(); };
  return ppjSeqNaFila(st, async () => {
    let ins;
    try { ins = await sb.from(PPJ_SEQ_TABELA).insert(reg.linha).select(PPJ_SEQ_COLUNAS); }
    catch(e){ ins = { data: null, error: e }; }
    if(ins.error || !ins.data || ins.data.length !== 1){
      if(ins.error) console.error("Marcar em sequência, criação da estaca:", ins.error);
      return falhou(ppjSeqMensagem(ins.error, `A estaca ${nome} não foi criada`));
    }
    const nova = ins.data[0];
    let pos;
    try { pos = await ppjPosGravar(st.plantaId, st.obraId, { op: "gravar", estaca_id: nova.id, x: p.x, y: p.y }); }
    catch(e){ pos = { ok: false, erro: e }; }
    if(!pos.ok){
      if(pos.erro) console.error("Marcar em sequência, posição da estaca nova:", pos.erro);
      // a estaca criada neste passo não fica na obra sem posição: sai
      let del;
      try { del = await sb.from(PPJ_SEQ_TABELA).delete().eq("id", nova.id).eq("status", "prevista").select("id"); }
      catch(e){ del = { data: null, error: e }; }
      const saiu = !del.error && del.data && del.data.length === 1;
      if(!saiu){   // nem a posição nem a limpeza: a estaca existe no banco, e a tela passa a mostrá-la em "Sem posição"
        const lista = ppjSeqLista();
        if(lista && !lista.some(e => e.id === nova.id)) lista.push({ ...nova, _execs_total: 0, _execs_refuros: 0, _alterada: false });
        q.novas = q.novas.concat(nova.id);
        if(typeof renderEstacas === "function") renderEstacas();
      }
      const porque = !pos.erro ? "o banco não devolveu a linha" : typeof ehErroDePermissao === "function" && ehErroDePermissao(pos.erro) ? "seu cargo não altera a posição das estacas nesta obra" : String(pos.erro.message || pos.erro).replace(/[.\s]+$/, "");
      return falhou(saiu ? `A estaca ${nome} não foi criada: a posição dela não gravou (${porque}). Nada ficou gravado.`
        : `A estaca ${nome} foi criada, mas a posição não gravou e não foi possível apagá-la: ela está na lista "Por estaca", sem posição. Confira na lista de estacas.`);
    }
    const lista = ppjSeqLista();
    if(lista && !lista.some(e => e.id === nova.id)) lista.push({ ...nova, _execs_total: 0, _execs_refuros: 0, _alterada: false });
    st.mapa = ppjPosAplicar(st.mapa, { op: "gravar", estaca_id: nova.id, x: p.x, y: p.y });
    ppjPosGuardar(st);
    q.novas = q.novas.concat(nova.id);
    ppjSeqEmpilhar(st, { composta: true, tipo: "criar", estaca_id: nova.id, numero: nome, depois: { x: p.x, y: p.y } });
    q.ocupado = false;
    if(q.pendente === p) ppjSeqAvancar(q, nome);
    if(typeof renderEstacas === "function") renderEstacas(); else ppjSeqRepintar();   // a conta de previstas da aba muda
  });
}

/* ---------- ações do modo "Por bloco" ---------- */
/* Grava de uma vez a posição das estacas do bloco, como na prévia confirmada. Uma instrução só no banco: ou entram
   todas, ou nenhuma. */
function ppjSeqPosicionarBloco(st, q){
  const pv = q.previa, p = q.pendente;
  if(!pv || !p || q.ocupado || !st.editando || !ppjPodeEditar()) return;
  const estacas = ppjEstacas();
  const itens = pv.itens.filter(i => !st.mapa.has(i.estaca_id) && estacas.some(e => e.id === i.estaca_id));
  const linhas = itens.map(i => ppjPosLinha(st.plantaId, i.estaca_id, st.obraId, i.x, i.y));
  if(!itens.length || itens.length > PPJ_SEQ_BLOCO_MAX || linhas.some(l => !l)){ ppjSeqCancelar(q); ppjSeqRepintar(); return; }
  q.ocupado = true;
  ppjPosAvisar("");
  ppjSeqRepintar();
  return ppjSeqNaFila(st, async () => {
    let r;
    try { r = await sb.from(PPJ_POS_TABELA).upsert(linhas, { onConflict: "planta_id,estaca_id" }).select(PPJ_POS_COLUNAS); }
    catch(e){ r = { data: null, error: e }; }
    q.ocupado = false;
    if(r.error || !r.data || r.data.length !== linhas.length){
      if(r.error) console.error("Marcar por bloco, gravação:", r.error);
      const msg = r.error ? ppjPosMensagem(r.error).replace("a posição da estaca", `a posição das estacas do ${ppjSeqRotuloBloco().toLowerCase()} ${pv.bloco}`)
        : `As estacas do ${ppjSeqRotuloBloco().toLowerCase()} ${pv.bloco} não foram posicionadas: seu cargo não altera a posição das estacas nesta obra, ou outra pessoa mexeu nesta folha. A tela foi atualizada.`;
      if(q.pendente === p) p.msg = "";
      ppjPosAvisar(msg);
      aviso("app-aviso", msg, "erro");
      if(!r.error){ _ppjPosCache.delete(st.plantaId); ppjSeqCancelar(q); ppjPosCarregar(st); }   // voltou menos do que foi: relê o que o banco tem
      ppjSeqRepintar();
      return;
    }
    let mapa = st.mapa;
    for(const i of itens) mapa = ppjPosAplicar(mapa, { op: "gravar", estaca_id: i.estaca_id, x: i.x, y: i.y });
    st.mapa = mapa;
    ppjPosGuardar(st);
    ppjSeqEmpilhar(st, { composta: true, tipo: "bloco", bloco: pv.bloco, itens: itens.map(i => ({ estaca_id: i.estaca_id, x: i.x, y: i.y })) });
    // o bloco da vez passa para o seguinte da lista
    const lista = ppjSeqBlocos(estacas, mapa, { local: st.local, todas: st.todas, termo: q.termoBloco }), k = lista.findIndex(g => ppjPosCompararNomes(g.bloco, pv.bloco) > 0);
    q.blocoDaVez = lista.length ? lista[k >= 0 ? k : 0].chave : null;
    if(q.pendente === p) ppjSeqCancelar(q);
    ppjSeqRepintar();
  });
}

/* ---------- desfazer (ações compostas deste módulo na pilha da 167b) ---------- */
function ppjSeqDesfazer(st, acao){
  const q = ppjSeqEstado();
  if(!acao || !st.editando || !ppjPodeEditar()) return;
  const devolve = (msg) => { ppjSeqEmpilhar(st, acao); ppjPosAvisar(msg); aviso("app-aviso", msg, "erro"); ppjSeqRepintar(); };
  ppjSeqCancelar(q);
  ppjPosAvisar("");
  ppjSeqRepintar();
  if(acao.tipo === "bloco"){
    const ids = acao.itens.map(i => i.estaca_id).filter(id => st.mapa.has(id));
    if(!ids.length) return;
    return ppjSeqNaFila(st, async () => {
      let r;
      try { r = await sb.from(PPJ_POS_TABELA).delete().eq("planta_id", st.plantaId).in("estaca_id", ids).select("estaca_id"); }
      catch(e){ r = { data: null, error: e }; }
      if(r.error || !r.data || !r.data.length){
        if(r.error) console.error("Marcar por bloco, desfazer:", r.error);
        return devolve(ppjPosMensagem(r.error));
      }
      let mapa = st.mapa;
      for(const l of r.data) mapa = ppjPosAplicar(mapa, { op: "tirar", estaca_id: l.estaca_id });
      st.mapa = mapa;
      ppjPosGuardar(st);
      ppjSeqRepintar();
    });
  }
  if(acao.tipo !== "criar") return;
  const id = acao.estaca_id;
  return ppjSeqNaFila(st, async () => {
    // 1. a posição sai desta folha
    if(st.mapa.has(id)){
      let pos;
      try { pos = await ppjPosGravar(st.plantaId, st.obraId, { op: "tirar", estaca_id: id }); }
      catch(e){ pos = { ok: false, erro: e }; }
      if(!pos.ok){
        if(pos.erro) console.error("Marcar em sequência, desfazer a posição:", pos.erro);
        return devolve(ppjPosMensagem(pos.erro));
      }
      st.mapa = ppjPosAplicar(st.mapa, { op: "tirar", estaca_id: id });
      ppjPosGuardar(st);
    }
    // 2. a estaca só sai da obra se foi criada nesta sessão, continua prevista, sem execução e sem outra folha (lido do banco agora)
    let motivo = "";
    try {
      const [e, x, f] = await Promise.all([
        sb.from(PPJ_SEQ_TABELA).select("id,status").eq("id", id),
        sb.from(PPJ_SEQ_VIEW_EXEC).select("id").eq("obra_id", st.obraId).eq("estaca_id", id).range(0, 0),
        sb.from(PPJ_POS_TABELA).select("planta_id").eq("estaca_id", id).range(0, 0)]);
      if(e.error || x.error || f.error) motivo = "não foi possível conferir a estaca no banco";
      else {
        const pode = ppjSeqPodeApagar({ estaca: (e.data || [])[0], novas: q.novas, temExecucao: (x.data || []).length > 0, emOutraFolha: (f.data || []).length > 0 });
        if(!pode.apaga) motivo = pode.motivo;
        else {
          const del = await sb.from(PPJ_SEQ_TABELA).delete().eq("id", id).eq("status", "prevista").select("id");
          if(del.error || !del.data || del.data.length !== 1){ if(del.error) console.error("Marcar em sequência, desfazer a estaca:", del.error); motivo = del.error ? String(del.error.message || "o banco recusou") : "o banco não apagou a linha"; }
        }
      }
    } catch(e){ console.error("Marcar em sequência, desfazer:", e); motivo = String((e && e.message) || e); }
    if(!motivo){
      const lista = ppjSeqLista(), k = lista ? lista.findIndex(e => e.id === id) : -1;
      if(k >= 0) lista.splice(k, 1);
      q.novas = q.novas.filter(n => n !== id);
    } else {
      const msg = `A estaca ${acao.numero} saiu desta folha, mas continua na obra: ${motivo.replace(/[.\s]+$/, "")}. Se for o caso, exclua pela lista de estacas.`;
      ppjPosAvisar(msg);
      aviso("app-aviso", msg, "aviso");
    }
    if(typeof renderEstacas === "function") renderEstacas(); else ppjSeqRepintar();
  });
}

/* ---------- "Definir bloco" ---------- */
async function ppjSeqPedirDefinir(st, q){
  const bloco = ppjSeqTxt(q.blocoNovo);
  if(q.ocupado || !q.selecao.size || q.selecao.size > PPJ_SEQ_SEL_MAX) return;
  if(!bloco){ q.resultado = { ok: 0, falhas: [{ nome: ppjSeqRotuloBloco(), motivo: "digite o nome antes de definir" }] }; ppjSeqRepintar(); return; }
  q.resultado = null;
  q.definir = { bloco, ocupado: false };
  ppjSeqRepintar();
  if(q.medidas === null || q.medidas === false){   // estacas já medidas: só para avisar na confirmação
    q.medidas = null;
    let r;
    try { r = await sb.rpc("estacas_medidas", { p_obra: st.obraId }); }
    catch(e){ r = { data: null, error: e }; }
    if(q !== _ppjSeq) return;
    if(r.error) console.error("Definir bloco, estacas medidas:", r.error);
    q.medidas = r.error ? false : new Set(r.data || []);
    ppjSeqRepintar();
  }
}
/* grava o bloco nas selecionadas, uma a uma: a que colide com outra estaca de mesmo nome no bloco é dita e não derruba as outras */
function ppjSeqDefinirBloco(st, q){
  const d = q.definir;
  if(!d || d.ocupado || q.ocupado || !st.editando || !ppjPodeEditar()) return;
  const estacas = ppjEstacas(), alvos = [...q.selecao].map(id => estacas.find(e => e.id === id)).filter(Boolean).slice(0, PPJ_SEQ_SEL_MAX);
  if(!alvos.length){ q.definir = null; ppjSeqRepintar(); return; }
  d.ocupado = true; q.ocupado = true;
  ppjPosAvisar("");
  ppjSeqRepintar();
  return ppjSeqNaFila(st, async () => {
    const falhas = [], feitas = [];
    for(const e of alvos){
      const nome = ppjSeqNorm(e.numero) || "(sem nº)", rotulo = ppjSeqRotuloEstaca(e);
      if(ppjSeqTxt(e.bloco) === d.bloco){ feitas.push(e.id); continue; }
      let r;
      try { r = await sb.from(PPJ_SEQ_TABELA).update({ bloco: d.bloco }).eq("id", e.id).select("id,bloco"); }
      catch(err){ r = { data: null, error: err }; }
      if(r.error || !r.data || r.data.length !== 1){
        if(r.error) console.error("Definir bloco, gravação:", r.error);
        const dup = r.error && (String(r.error.code) === "23505" || /duplicate key|unique constraint/i.test(String(r.error.message || "")));
        falhas.push({ nome: rotulo, motivo: dup ? `já existe ${nome} em ${d.bloco}` : !r.error ? "o banco não gravou (cargo sem permissão nesta obra?)" : typeof ehErroDePermissao === "function" && ehErroDePermissao(r.error) ? "seu cargo não altera estacas nesta obra" : String(r.error.message || r.error).replace(/[.\s]+$/, "") });
        continue;
      }
      e.bloco = r.data[0].bloco;
      feitas.push(e.id);
    }
    q.ocupado = false;
    q.definir = null;
    q.resultado = { ok: feitas.length, falhas };
    q.selecao = new Set([...q.selecao].filter(id => !feitas.includes(id)));   // as que falharam continuam selecionadas
    if(!falhas.length) q.blocoNovo = "";
    if(typeof renderEstacas === "function") renderEstacas(); else ppjSeqRepintar();
  });
}

/* ---------- eventos do visor (delegados: o painel e a caixa são redesenhados) ---------- */
function ppjSeqMudarModo(st, q, modo){
  if(q.ocupado || !["estaca", "bloco", "sequencia"].includes(modo) || q.modo === modo) return;
  q.modo = modo;
  ppjSeqCancelar(q);
  q.msgForm = ""; q.resultado = null;
  ppjPosAvisar("");
  ppjSeqRepintar();
}
function ppjSeqClique(ev){
  const st = _ppjPos, q = _ppjSeq, alvo = ev.target;
  if(!alvo || !alvo.closest || !st.editando || !ppjPodeEditar()) return;
  const modo = alvo.closest("[data-ppj-seq-modo]");
  if(modo) return void ppjSeqMudarModo(st, q, modo.dataset.ppjSeqModo);
  const acao = alvo.closest("[data-ppj-seq]");
  if(acao){
    if(acao.disabled) return;
    const qual = acao.dataset.ppjSeq;
    if(qual === "ok") ppjSeqOk(st, q);
    else if(qual === "cancelar"){ if(!q.ocupado){ ppjSeqCancelar(q); ppjSeqRepintar(); } }
    else if(qual === "definir") ppjSeqPedirDefinir(st, q);
    else if(qual === "definir-ok") ppjSeqDefinirBloco(st, q);
    else if(qual === "definir-cancelar"){ if(!q.ocupado){ q.definir = null; ppjSeqRepintar(); } }
    else if(qual === "limpar-sel"){ if(!q.ocupado){ q.selecao = new Set(); q.definir = null; q.resultado = null; ppjSeqRepintar(); } }
    return;
  }
  const bloco = alvo.closest("[data-ppj-seq-bloco]");
  if(bloco && !q.ocupado){ q.blocoDaVez = bloco.dataset.ppjSeqBloco; ppjSeqCancelar(q); ppjSeqRepintar(); }
}
function ppjSeqTecla(ev){
  const st = _ppjPos, q = _ppjSeq, alvo = ev.target, tecla = String(ev.key || "");
  if(!alvo || !st.editando || !ppjPodeEditar()) return;
  if(tecla === "Escape" && (q.pendente || q.definir) && !q.ocupado){
    ev.preventDefault();
    if(q.pendente) ppjSeqCancelar(q); else q.definir = null;
    ppjSeqRepintar();
    return;
  }
  if(tecla !== "Enter" && tecla !== " ") return;
  if(alvo.id === "ppj-seq-nome"){ if(tecla === "Enter"){ ev.preventDefault(); ppjSeqOk(st, q); } return; }
  if(alvo.id === "ppj-seq-bloco-novo"){ if(tecla === "Enter"){ ev.preventDefault(); ppjSeqPedirDefinir(st, q); } return; }
  const bloco = alvo.closest ? alvo.closest("[data-ppj-seq-bloco]") : null;
  if(bloco && !q.ocupado){ ev.preventDefault(); q.blocoDaVez = bloco.dataset.ppjSeqBloco; ppjSeqCancelar(q); ppjSeqRepintar(); }
}
/* o que a pessoa digita na barra vai direto para o estado: a barra não é refeita enquanto ela digita */
function ppjSeqCampo(ev){
  const q = _ppjSeq, el = ev.target, id = el ? el.id : "";
  if(!id || !_ppjPos.editando || q.ocupado) return;
  const v = String(el.value ?? "");
  if(id === "ppj-seq-proximo"){ q.proximo = ppjSeqNorm(v); q.msgForm = ""; const m = $("ppj-seq-form-msg"); if(m) m.textContent = ""; }
  else if(id === "ppj-seq-passo"){ const n = Math.trunc(Number(v)); q.passo = Number.isFinite(n) && n ? n : 1; }
  else if(id === "ppj-seq-bloco") q.bloco = ppjSeqTxt(v);
  else if(id === "ppj-seq-local") q.local = ppjSeqTxt(v);
  else if(id === "ppj-seq-tipo") q.tipo = v;
  else if(id === "ppj-seq-diam") q.diametro = v.trim();
  else if(id === "ppj-seq-bloco-novo") q.blocoNovo = v;
  else if(id === "ppj-seq-bloco-busca"){ q.termoBloco = v.trim(); ppjSeqCancelar(q); ppjSeqRepintar(); }
}
function ligarPlantaSequencia(){
  if(typeof $ !== "function") return;
  const visor = $("ppj-visor");
  if(!visor) return;
  visor.addEventListener("click", ppjSeqClique);
  visor.addEventListener("keydown", ppjSeqTecla);
  visor.addEventListener("input", ppjSeqCampo);
  visor.addEventListener("change", ppjSeqCampo);
}

if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarPlantaSequencia);
  else ligarPlantaSequencia();
}

// teste em Node (scripts/testar-fase169b.mjs): as funções puras saem pelo mesmo module.exports de js/planta_projeto.js
if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPJ_SEQ_TABELA, PPJ_SEQ_COLUNAS, PPJ_SEQ_BLOCO_MAX, PPJ_SEQ_SEL_MAX, PPJ_SEQ_NOME_MAX, PPJ_SEQ_DIAM_MIN, PPJ_SEQ_DIAM_MAX, PPJ_SEQ_SEP,
    ppjProximoNome, ppjArranjoBloco, ppjSeqNorm, ppjSeqCandidatas, ppjSeqLinhaEstaca, ppjSeqBlocos, ppjSeqPodeApagar, ppjSeqPadroes, ppjSeqPrevias, ppjSeqMensagem,
    ppjSeqModosHTML, ppjSeqFormHTML, ppjSeqBlocosHTML, ppjSeqCaixaHTML, ppjSeqSelecaoHTML });
}

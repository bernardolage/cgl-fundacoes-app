/* ====================================================================
   NCM (fase 105a, 22/10/2026) — tabela de apoio e o bloco "Fiscal" das fichas de produto, equipamento e acessório.

   FISCAL_NCM é uma TIPI reduzida: só os capítulos que a CGL usa (25 areia/cimento, 39 caixa d'água, 40 borracha, 72 aço,
   73 tubos e obras de ferro, 82 ferramentas de perfuração, 84 máquinas e 84.31 partes, 85 geradores e quadros, 87
   veículos). Montada de memória da TIPI, sem consulta ao texto vigente: o contador confirma.
   Códigos de 4 e 6 dígitos são posições/subposições, para orientar a busca: escolhê-los põe o começo do código no
   campo e falta completar os dígitos pela TIPI ou pela nota de compra do bem. Os de 8 dígitos são os itens mais usados.
   A classificação vale a da nota de compra; na dúvida, o contador confirma (docs/cargas/ncm-equipamentos.md).
   O campo aceita qualquer NCM de 8 dígitos digitado (com ou sem pontos), mesmo fora da tabela.

   Bloco Fiscal: fiscalItemMontar(pref) desenha os campos em #<pref>-fiscal (NCM com busca, unidade comercial, valor
   unitário para remessa com o sugerido por fiscal_valor_remessa()); fiscalItemPreencher(pref, tipo, registro) carrega;
   fiscalItemValores(pref) devolve { ncm, unidade_comercial, valor_remessa } para o salvar do módulo, { erro } ou null
   (null = banco ainda sem as colunas da migration 20261022_fase105a: o módulo não manda os campos).
   ==================================================================== */

const FISCAL_NCM = [
  // ---- 25: areia, brita, bentonita, cal, cimento ----
  ["2505", "Areias naturais"],
  ["25051000", "Areias siliciosas e areias quartzosas"],
  ["25059000", "Outras areias naturais (areia de construção)"],
  ["25081000", "Bentonita (lama de perfuração)"],
  ["25171000", "Calhaus, cascalho, pedras britadas (brita)"],
  ["2522", "Cal viva, cal apagada e cal hidráulica"],
  ["2523", "Cimentos hidráulicos"],
  ["25232910", "Cimento Portland comum"],
  ["25232990", "Outros cimentos Portland (CP II, CP III, CP V…)"],
  ["25239000", "Outros cimentos hidráulicos"],
  // ---- 39: plástico (só a caixa d'água dos acessórios de raiz) ----
  ["39251000", "Reservatórios de plástico acima de 300 l (caixa d'água)"],
  // ---- 40: borracha ----
  ["4009", "Tubos de borracha vulcanizada (mangueiras, mangotes)"],
  ["400911", "Mangueira de borracha sem reforço, sem acessórios"],
  ["400921", "Mangueira reforçada com metal, sem acessórios"],
  ["400922", "Mangueira reforçada com metal, com acessórios (mangote de injeção com engate)"],
  ["400931", "Mangueira reforçada com têxtil, sem acessórios"],
  ["400932", "Mangueira reforçada com têxtil, com acessórios"],
  ["40169990", "Outras obras de borracha vulcanizada (amortecedor, vedação)"],
  // ---- 72: aço ----
  ["7213", "Fio-máquina de ferro ou aço não ligado"],
  ["72131000", "Fio-máquina com nervuras da laminação"],
  ["7214", "Barras de ferro ou aço não ligado"],
  ["72142000", "Barras com nervuras (vergalhão CA-50)"],
  ["7217", "Fios de ferro ou aço não ligado (CA-60, arame)"],
  // ---- 73: tubos e obras de ferro ou aço ----
  ["7304", "Tubos sem costura, de ferro ou aço"],
  ["730439", "Tubo sem costura, seção circular, aço não ligado (camisa, tubo de secante)"],
  ["730459", "Tubo sem costura, seção circular, outras ligas de aço"],
  ["7306", "Outros tubos de ferro ou aço (soldados)"],
  ["73063000", "Tubo soldado, seção circular, ferro ou aço não ligado"],
  ["73065000", "Tubo soldado, seção circular, outras ligas de aço"],
  ["7307", "Acessórios para tubos (flanges, luvas, curvas)"],
  ["73079100", "Flanges"],
  ["73079200", "Cotovelos, curvas e luvas roscados"],
  ["73079300", "Acessórios para soldar topo a topo"],
  ["73079900", "Outros acessórios para tubos"],
  ["7308", "Construções e partes de construções, de ferro ou aço"],
  ["73084000", "Material para andaimes, formas e escoramentos"],
  ["7309", "Reservatórios de ferro ou aço acima de 300 l (caixa d'água metálica)"],
  ["73089090", "Outras construções e partes, de ferro ou aço"],
  ["73181500", "Parafusos e pinos, mesmo com porcas"],
  ["73269090", "Outras obras de ferro ou aço"],
  // ---- 82: ferramentas intercambiáveis de perfuração ----
  ["8207", "Ferramentas intercambiáveis (perfuração e sondagem)"],
  ["82071300", "Ferramenta de perfuração/sondagem com parte operante de ceramais (coroa, bit, tricone de metal duro)"],
  ["82071900", "Outras ferramentas de perfuração/sondagem, incluídas as partes"],
  // ---- 84: máquinas ----
  ["8413", "Bombas para líquidos"],
  ["84134000", "Bombas para concreto"],
  ["841350", "Outras bombas volumétricas alternativas (pistão: argamassa, injeção)"],
  ["841370", "Outras bombas centrífugas (bomba d'água)"],
  ["84138100", "Outras bombas"],
  ["8414", "Compressores"],
  ["841440", "Compressor de ar sobre chassi com rodas, rebocável"],
  ["841480", "Outros compressores"],
  ["8426", "Guindastes"],
  ["842641", "Guindaste autopropulsado sobre pneus"],
  ["842649", "Outros guindastes autopropulsados"],
  ["842720", "Outras empilhadeiras autopropulsadas"],
  ["8429", "Escavadeiras, pás carregadoras, tratores de lâmina (autopropulsados)"],
  ["842951", "Carregadeira e pá carregadeira de carregamento frontal"],
  ["842952", "Máquina com superestrutura que gira 360° (escavadeira)"],
  ["842959", "Outras (retroescavadeira)"],
  ["8430", "Máquinas de perfuração e sondagem; bate-estacas"],
  ["84301000", "Bate-estacas e arranca-estacas"],
  ["843041", "Perfuratriz/sondagem autopropulsada (sobre esteira ou pneus)"],
  ["843049", "Perfuratriz/sondagem não autopropulsada"],
  ["84305000", "Outras máquinas de terraplenagem/escavação autopropulsadas"],
  ["8431", "Partes das máquinas 84.25 a 84.30"],
  ["843141", "Caçambas, pás, ganchos e garras"],
  ["843143", "Partes de perfuratriz/sondagem (8430.41 e 8430.49): hélice, trado, haste, guia, ponta"],
  ["843149", "Outras partes de guindaste, escavadeira e máquinas 84.30"],
  ["8474", "Máquinas de misturar (minerais)"],
  ["84743100", "Betoneiras e aparelhos para amassar cimento (misturador de argamassa)"],
  ["847439", "Outras máquinas de misturar"],
  ["847910", "Máquinas para obras públicas e construção civil"],
  ["848340", "Engrenagens, caixas de transmissão e redutores (caixa redutora)"],
  // ---- 85: geradores e quadros ----
  ["8502", "Grupos geradores"],
  ["850211", "Grupo gerador diesel até 75 kVA"],
  ["850212", "Grupo gerador diesel de 75 a 375 kVA"],
  ["850213", "Grupo gerador diesel acima de 375 kVA"],
  ["853710", "Quadros e painéis elétricos até 1.000 V"],
  // ---- 87: veículos ----
  ["8704", "Veículos para transporte de mercadorias (caminhões)"],
  ["870421", "Veículo de carga diesel, PBT até 5 t (furgão, Sprinter)"],
  ["870422", "Caminhão diesel, PBT acima de 5 t até 20 t"],
  ["870423", "Caminhão diesel, PBT acima de 20 t"],
  ["870510", "Caminhão-guindaste (munck)"],
  ["871639", "Outros reboques e semirreboques de carga"]
];
const _ncmMapa = Object.fromEntries(FISCAL_NCM);

function ncmDigitos(v){ return String(v || "").replace(/\D/g, ""); }
function ncmFormatar(v){
  const d = ncmDigitos(v);
  if(d.length <= 4) return d;
  if(d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}
/* descrição do código ou da subposição/posição mais próxima da tabela de apoio */
function ncmDescricao(v){
  const d = ncmDigitos(v);
  for(const n of [8, 6, 4]){ if(d.length >= n && _ncmMapa[d.slice(0, n)]) return _ncmMapa[d.slice(0, n)]; }
  return "";
}
function ncmNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function ncmBuscar(termo){
  const t = ncmNorm(termo).trim();
  if(!t) return [];
  const dig = t.replace(/[.\s]/g, "");
  const porCodigo = /^\d+$/.test(dig);
  const palavras = t.split(/\s+/).filter(Boolean);
  return FISCAL_NCM.filter(([c, d]) => porCodigo ? c.startsWith(dig) || dig.startsWith(c) : palavras.every(p => ncmNorm(d).includes(p)))
    .slice(0, 25);
}

/* ---------- bloco Fiscal das fichas ---------- */
const FISCAL_ITEM_ORIGEM = { informado: "informado", avaliacao: "avaliação de mercado (Patrimônio)", aquisicao: "valor de aquisição", preco_referencia: "preço de referência do modelo", custo: "último custo" };
const FISCAL_ITEM_TABELA = { equipamento: "equipamentos", acessorio: "acessorios", produto: "produtos" };
const _fiscalItem = {};   // por prefixo: { disponivel, tipo, id }

function fiscalItemMontar(pref){
  const box = $(`${pref}-fiscal`);
  if(!box || box.dataset.montado) return;
  box.dataset.montado = "1";
  box.innerHTML = `<p class="texto-apoio compacto">NCM, unidade e valor que a NF-e de remessa usa (fase 105). O NCM mais seguro é o da nota de compra do bem; na dúvida, o contador confirma.</p>
    <p class="meta" id="${pref}-fiscal-aviso" style="display:none;"></p>
    <div class="grade">
      <div class="campo"><label>NCM</label>
        <div class="forn-campo"><input id="${pref}-ncm" placeholder="8 dígitos, ou busque: perfuratriz, bomba…" autocomplete="off" />
          <div class="autocomplete-lista" id="${pref}-ncm-lista" style="display:none;"></div></div>
        <span class="meta" id="${pref}-ncm-desc"></span></div>
      <div class="campo"><label>Unidade comercial</label><input id="${pref}-ucom" maxlength="6" placeholder="UN" title="Unidade da NF-e (até 6 letras ou dígitos). Vazio = UN (produto: a unidade do cadastro)" /></div>
      <div class="campo"><label>Valor unitário para remessa (R$)</label><input id="${pref}-vrem" type="number" min="0" step="0.01" placeholder="vazio = sugerido" />
        <span class="meta" id="${pref}-vrem-sug"></span></div>
    </div>`;
  const inp = $(`${pref}-ncm`), lista = $(`${pref}-ncm-lista`), desc = $(`${pref}-ncm-desc`);
  const fechar = () => { lista.style.display = "none"; lista.innerHTML = ""; };
  const descrever = () => {
    const d = ncmDigitos(inp.value);
    const txt = ncmDescricao(d);
    let msg = "";
    if(d.length && d.length < 8) msg = `${txt ? txt + " · " : ""}faltam ${8 - d.length} dígito(s)`;
    else if(d.length > 8) msg = "O NCM tem 8 dígitos.";
    else if(d.length === 8) msg = txt || "Fora da tabela de apoio: confira na TIPI.";
    desc.textContent = msg;
    desc.classList.toggle("txt-perigo", !!d && d.length !== 8);
  };
  const escolher = (c) => {
    inp.value = ncmFormatar(c); fechar(); descrever();
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if(c.length < 8) inp.focus();
  };
  inp.addEventListener("input", debounce(() => {
    descrever();
    const t = inp.value.trim();
    if(t.length < 2 || ncmDigitos(t).length === 8){ fechar(); return; }
    const res = ncmBuscar(t);
    lista.innerHTML = res.length
      ? res.map(([c, d]) => `<div class="resultado-item" data-ncm="${esc(c)}"><strong>${esc(ncmFormatar(c))}</strong> ${esc(d)}${c.length < 8 ? ' <span class="meta">(completar os dígitos)</span>' : ""}</div>`).join("")
      : `<div class="resultado-item vazio">Nada na tabela de apoio. Digite o NCM de 8 dígitos da nota de compra.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-ncm]").forEach(el => el.addEventListener("mousedown", ev => { ev.preventDefault(); escolher(el.dataset.ncm); }));
  }, 150));
  inp.addEventListener("keydown", ev => {
    if(ev.key === "Enter"){ const el = lista.querySelector(".resultado-item[data-ncm]"); if(el && lista.style.display !== "none"){ ev.preventDefault(); escolher(el.dataset.ncm); } }
    if(ev.key === "Escape") fechar();
  });
  inp.addEventListener("blur", () => { setTimeout(fechar, 150); if(ncmDigitos(inp.value).length === 8) inp.value = ncmFormatar(inp.value); descrever(); });
}

/* tipo: equipamento | acessorio | produto. registro: o que a ficha abriu ({} ou sem id = novo).
   pode: false deixa os campos só para consulta (mesma regra de edição da ficha). */
async function fiscalItemPreencher(pref, tipo, registro, pode){
  fiscalItemMontar(pref);
  const r = registro || {};
  const est = _fiscalItem[pref] = { disponivel: false, tipo, id: r.id || null };
  const tabela = FISCAL_ITEM_TABELA[tipo];
  const inp = $(`${pref}-ncm`), ucom = $(`${pref}-ucom`), vrem = $(`${pref}-vrem`), sug = $(`${pref}-vrem-sug`), av = $(`${pref}-fiscal-aviso`);
  if(!inp) return;
  [inp, ucom, vrem].forEach(el => { el.disabled = true; });   // liberados depois de saber se as colunas existem
  inp.value = ""; ucom.value = ""; vrem.value = ""; sug.textContent = ""; vrem.placeholder = "vazio = sugerido"; $(`${pref}-ncm-desc`).textContent = "";
  ucom.placeholder = tipo === "produto" && r.unidade ? String(r.unidade).toUpperCase().slice(0, 6) : "UN";
  let dados = null;
  if(Object.prototype.hasOwnProperty.call(r, "ncm")) dados = r;
  else if(r.id){
    const { data, error } = await sb.from(tabela).select("ncm,unidade_comercial,valor_remessa").eq("id", r.id).maybeSingle();
    if(!error) dados = data || {};
  } else if(await fiscalColunaExiste(tabela, "ncm")) dados = {};
  if(_fiscalItem[pref] !== est) return;   // a ficha mudou enquanto lia
  est.disponivel = !!dados;
  av.style.display = est.disponivel ? "none" : "";
  av.textContent = est.disponivel ? "" : "Os campos fiscais chegam com a atualização do banco da fase 105a.";
  if(!est.disponivel) return;
  [inp, ucom, vrem].forEach(el => { el.disabled = pode === false; });
  inp.value = dados.ncm ? ncmFormatar(dados.ncm) : "";
  ucom.value = dados.unidade_comercial || "";
  vrem.value = dados.valor_remessa ?? "";
  inp.dispatchEvent(new Event("blur"));
  if(r.id){
    const { data } = await sb.rpc("fiscal_valor_remessa", { p_tipo: tipo, p_id: r.id });
    if(_fiscalItem[pref] !== est) return;
    const s = Array.isArray(data) ? data[0] : data;
    sug.textContent = s && s.valor != null
      ? (s.origem === "informado" ? "" : `Sugerido: ${brl(s.valor)} (${FISCAL_ITEM_ORIGEM[s.origem] || s.origem})`)
      : "Sem valor sugerido: informe o valor da remessa.";
    if(s && s.origem !== "informado" && s.valor != null) vrem.placeholder = `sugerido ${brl(s.valor)}`;
  }
}

/* null = sem as colunas no banco (o módulo não manda nada); { erro } = valor inválido; senão o trecho do salvar */
function fiscalItemValores(pref){
  const est = _fiscalItem[pref];
  if(!est || !est.disponivel) return null;
  const ncm = ncmDigitos($(`${pref}-ncm`)?.value);
  const ucom = ($(`${pref}-ucom`)?.value || "").trim().toUpperCase();
  const vtxt = ($(`${pref}-vrem`)?.value || "").trim();
  if(ncm && ncm.length !== 8) return { erro: "NCM com 8 dígitos (ex.: 8430.41.00), ou deixe em branco." };
  if(ucom && !/^[0-9A-Z]{1,6}$/.test(ucom)) return { erro: "Unidade comercial com até 6 letras ou dígitos (ex.: UN, PC, KG)." };
  const valor = vtxt === "" ? null : Number(vtxt.replace(",", "."));
  if(valor != null && !(valor >= 0)) return { erro: "Valor para remessa inválido." };
  return { ncm: ncm || null, unidade_comercial: ucom || null, valor_remessa: valor };
}

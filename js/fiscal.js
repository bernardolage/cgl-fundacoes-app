/* ====================================================================
   Fiscal (fase 105a, 22/10/2026) — cadastro que a NF-e de remessa e a NFS-e da medição vão exigir.
   Spec: docs/specs/fase-105-emissao-fiscal-focus-nfe.md (parte 105a). Nada aqui fala com a Focus NFe.

   - CPF/CNPJ: fiscalDocValido() espelha fiscal_doc_valido() do banco (dígitos verificadores; CNPJ alfanumérico
     de jul/2026: as 12 primeiras posições aceitam letras, valor = código ASCII − 48).
   - CEP → endereço e código IBGE do município pela ViaCEP (https://viacep.com.br/ws/<cep>/json/, campo "ibge").
     Sem rede (ou com a ViaCEP fora), o usuário digita: nada trava.
   - fiscalColunaExiste(): o front não quebra antes da migration 20261022_fase105a_cadastro_fiscal.sql. Cada tela
     pergunta uma vez se a coluna nova existe e, sem ela, esconde/desliga os campos novos e não os manda no salvar.
   - Bloco "Dados fiscais da empresa" (empresa_config.fiscal_*): desenhado em Usuários (diretor/admin) e na visão
     "Pendências fiscais" de Clientes (gestor de acessórios, financeiro e logística não veem Usuários). Só quem passa
     em podeEmitirFiscal() (core.js; fiscal_pode_emitir() no banco) grava; o admin vê e não edita (decisão 6).
   - NCM de produtos, equipamentos e acessórios: js/fiscal_ncm.js.
   - Fase 105b (NF-e de remessa/retorno pela Focus NFe): fiscalChamarFocus() fala com a edge function focus-nfe; o bloco
     da empresa ganha sede, CST/CSOSN, CFOPs, texto legal, IBS/CBS, o certificado A1 (arquivo e senha vão direto para a
     function e nunca ficam no banco, em log ou no console) e o registro do webhook. Sem a migration da 105b os campos
     novos ficam desligados (fiscalColunaExiste).
   ==================================================================== */

/* ---------- CPF / CNPJ ---------- */
function fiscalDocLimpo(v){ return String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); }
function fiscalDocValido(v){
  const d = fiscalDocLimpo(v);
  if(d.length === 11){
    if(!/^\d{11}$/.test(d) || /^(.)\1{10}$/.test(d)) return false;
    let s = 0; for(let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
    let r = (s * 10) % 11; if(r === 10) r = 0;
    if(r !== Number(d[9])) return false;
    s = 0; for(let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
    r = (s * 10) % 11; if(r === 10) r = 0;
    return r === Number(d[10]);
  }
  if(d.length === 14){
    if(!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
    const val = c => c.charCodeAt(0) - 48;
    const p1 = [5,4,3,2,9,8,7,6,5,4,3,2], p2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let s = 0; for(let i = 0; i < 12; i++) s += val(d[i]) * p1[i];
    let r = s % 11; r = r < 2 ? 0 : 11 - r;
    if(r !== Number(d[12])) return false;
    s = 0; for(let i = 0; i < 13; i++) s += val(d[i]) * p2[i];
    r = s % 11; r = r < 2 ? 0 : 11 - r;
    return r === Number(d[13]);
  }
  return false;
}
/* 14 posições → 00.000.000/0000-00; 11 → 000.000.000-00; outro tamanho volta como veio */
function fiscalFormatarDoc(v){
  const d = fiscalDocLimpo(v);
  if(d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if(d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return String(v || "");
}
function fiscalEmailsValidos(v){
  const t = String(v || "").trim();
  if(!t) return true;
  return t.split(/\s*[,;]\s*/).every(e => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(e));
}

/* ---------- a coluna nova já existe no banco? (uma consulta por tabela.coluna) ---------- */
const _fiscalColunas = {};
function fiscalColunaExiste(tabela, coluna){
  const k = tabela + "." + coluna;
  if(!_fiscalColunas[k]){
    // só guarda a resposta certa (coluna existe, ou 42703 = não existe); falha de rede pergunta de novo na próxima vez
    _fiscalColunas[k] = sb.from(tabela).select(coluna).limit(1)
      .then(({ error }) => {
        if(error && error.code !== "42703") delete _fiscalColunas[k];
        return !error;
      })
      .catch(() => { delete _fiscalColunas[k]; return false; });
  }
  return _fiscalColunas[k];
}

/* ---------- CEP → endereço e IBGE (ViaCEP) ---------- */
async function fiscalBuscarCep(cep){
  const d = String(cep || "").replace(/\D/g, "");
  if(d.length !== 8) return { erro: "CEP com 8 dígitos." };
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const tempo = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, ctl ? { signal: ctl.signal } : undefined);
    if(!r.ok) return { erro: `ViaCEP respondeu ${r.status}. Preencha à mão.` };
    const j = await r.json();
    if(!j || j.erro) return { erro: "CEP não encontrado. Confira o número ou preencha à mão." };
    return { cep: j.cep || d, logradouro: j.logradouro || "", bairro: j.bairro || "", cidade: j.localidade || "",
             uf: String(j.uf || "").toLowerCase(), ibge: /^\d{7}$/.test(String(j.ibge || "")) ? String(j.ibge) : "" };
  } catch(e){
    return { erro: "Sem acesso à ViaCEP agora. Preencha cidade, UF e o código IBGE à mão." };
  } finally { if(tempo) clearTimeout(tempo); }
}
/* Liga CEP → campos. ids: { cep, botao, status, logradouro, bairro, cidade, uf, ibge }.
   Busca ao sair do campo (CEP completo e diferente do último buscado) e no botão. Logradouro e bairro só são
   preenchidos se estiverem vazios; cidade, UF e IBGE seguem o CEP (é o que a nota exige). */
function fiscalLigarCep(ids){
  const elCep = $(ids.cep);
  if(!elCep || elCep.dataset.fiscalCep) return;
  elCep.dataset.fiscalCep = "1";
  const st = (txt, tipo) => { const s = $(ids.status); if(s){ s.textContent = txt || ""; s.classList.toggle("txt-perigo", tipo === "erro"); } };
  async function buscar(forcar){
    const d = elCep.value.replace(/\D/g, "");
    if(d.length !== 8){ if(forcar) st("Informe o CEP com 8 dígitos.", "erro"); return; }
    if(!forcar && elCep.dataset.ultimo === d) return;
    elCep.dataset.ultimo = d;
    st("Buscando o CEP…");
    const r = await fiscalBuscarCep(d);
    if(r.erro){ st(r.erro, "erro"); return; }
    const pos = (id, v, soVazio) => { const el = $(id); if(!el || !v) return; if(soVazio && el.value.trim()) return; el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
    elCep.value = r.cep;
    pos(ids.logradouro, r.logradouro, true);
    pos(ids.bairro, r.bairro, true);
    pos(ids.cidade, r.cidade, false);
    pos(ids.uf, r.uf, false);
    if(ids.ibge && $(ids.ibge) && !$(ids.ibge).disabled) pos(ids.ibge, r.ibge, false);
    st(`${r.cidade}/${r.uf.toUpperCase()}${r.ibge ? " · IBGE " + r.ibge : ""}`);
  }
  elCep.addEventListener("blur", () => buscar(false));
  const b = $(ids.botao); if(b) b.addEventListener("click", () => buscar(true));
}

/* ---------- Dados fiscais da empresa (empresa_config.fiscal_*) ---------- */
const FISCAL_REGIMES = { simples_nacional: "Simples Nacional", lucro_presumido: "Lucro presumido", lucro_real: "Lucro real" };
const FISCAL_EMPRESA_COLS = "fiscal_cnpj,fiscal_razao_social,fiscal_ie,fiscal_im,fiscal_regime_tributario,fiscal_cnae,fiscal_codigo_servico,fiscal_item_lc116,fiscal_iss_aliquota,fiscal_nfe_serie,fiscal_nfe_proximo_numero,fiscal_nfse_serie,fiscal_nfse_proximo_numero,fiscal_ambiente,fiscal_contador_email";
const FISCAL_EMPRESA_COLS_105B = "fiscal_uf,fiscal_codigo_municipio,fiscal_cst_icms_remessa,fiscal_cst_pis_cofins_remessa,fiscal_cst_pis_cofins_retorno,fiscal_texto_legal_remessa,fiscal_cfop_remessa_dentro_uf,fiscal_cfop_remessa_fora_uf,fiscal_cfop_retorno_dentro_uf,fiscal_cfop_retorno_fora_uf,fiscal_ibs_cbs_cst_remessa,fiscal_ibs_cbs_cclass_remessa,fiscal_certificado_validade,fiscal_certificado_enviado_em,fiscal_focus_webhook_registrado_em,fiscal_focus_webhook_ambiente";
const _fiscalEmpresa = {};   // por prefixo: último registro lido
/* o que falta para a primeira emissão (a 105b confere de novo antes de emitir) */
function fiscalEmpresaPendencias(e){
  if(!e) return [];
  const vazio = v => v == null || String(v).trim() === "";
  return [
    vazio(e.fiscal_cnpj) && "CNPJ", vazio(e.fiscal_razao_social) && "razão social", vazio(e.fiscal_ie) && "IE",
    vazio(e.fiscal_im) && "IM", vazio(e.fiscal_regime_tributario) && "regime", vazio(e.fiscal_cnae) && "CNAE",
    vazio(e.fiscal_codigo_servico) && "código de serviço", vazio(e.fiscal_iss_aliquota) && "ISS",
    (vazio(e.fiscal_nfe_serie) || vazio(e.fiscal_nfe_proximo_numero)) && "série/número da NF-e",
    (vazio(e.fiscal_nfse_serie) || vazio(e.fiscal_nfse_proximo_numero)) && "série/número da NFS-e",
    // fase 105b (só quando as colunas existem)
    ("fiscal_cst_icms_remessa" in e) && vazio(e.fiscal_cst_icms_remessa) && "CST/CSOSN da remessa",
    ("fiscal_codigo_municipio" in e) && (vazio(e.fiscal_uf) || vazio(e.fiscal_codigo_municipio)) && "UF/município da sede",
    ("fiscal_certificado_validade" in e) && vazio(e.fiscal_certificado_validade) && "certificado A1"
  ].filter(Boolean);
}
async function fiscalEmpresaRender(pref){
  const box = $(pref);
  if(!box) return;
  const tem105b = await fiscalColunaExiste("empresa_config", "fiscal_cfop_remessa_dentro_uf");
  const { data, error } = await sb.from("empresa_config").select(FISCAL_EMPRESA_COLS + (tem105b ? "," + FISCAL_EMPRESA_COLS_105B : "")).eq("id", 1).maybeSingle();
  if(error){
    const semColuna = error.code === "42703" || /fiscal_/i.test(error.message || "");
    box.innerHTML = `<div class="lista-topo"><h3>Dados fiscais da empresa</h3></div>
      <p class="vazio">${semColuna ? "Os dados fiscais da empresa chegam com a atualização do banco da fase 105a." : "Não foi possível ler os dados fiscais: " + esc(error.message || "erro")}</p>`;
    return;
  }
  const e = data || {};
  _fiscalEmpresa[pref] = e;
  const pode = typeof podeEmitirFiscal === "function" && podeEmitirFiscal();
  const id = s => `${pref}-${s}`;
  const v = x => esc(x == null ? "" : x);
  const pend = fiscalEmpresaPendencias(e);
  const amb = e.fiscal_ambiente || "homologacao";
  box.innerHTML = `<div class="lista-topo">
      <h3>Dados fiscais da empresa</h3>
      <span class="tag ${amb === "producao" ? "verde" : "ambar"}" title="Ambiente da Focus NFe usado na emissão (fase 105b)">${amb === "producao" ? "Produção" : "Homologação"}</span>
      ${pend.length ? `<span class="tag ambar" title="O que falta para a primeira emissão">falta: ${esc(pend.join(", "))}</span>` : `<span class="tag verde">completo</span>`}
    </div>
    <p class="texto-apoio compacto">Emitente da NF-e de remessa e da NFS-e da medição (fase 105). Editam: gestor de acessórios, financeiro, logística e diretor${pode ? "" : " (seu cargo só consulta)"}. O contador confere antes da primeira emissão; a numeração continua a da UniNFe.</p>
    <div class="grade">
      <div class="campo"><label>CNPJ</label><input id="${id("cnpj")}" value="${v(e.fiscal_cnpj ? fiscalFormatarDoc(e.fiscal_cnpj) : "")}" placeholder="00.000.000/0000-00" /></div>
      <div class="campo largo"><label>Razão social</label><input id="${id("razao")}" value="${v(e.fiscal_razao_social)}" /></div>
      <div class="campo"><label>Inscrição estadual</label><input id="${id("ie")}" value="${v(e.fiscal_ie)}" /></div>
      <div class="campo"><label>Inscrição municipal</label><input id="${id("im")}" value="${v(e.fiscal_im)}" /></div>
      <div class="campo"><label>Regime tributário</label><select id="${id("regime")}"><option value="">— não informado —</option>${Object.entries(FISCAL_REGIMES).map(([k, t]) => `<option value="${k}" ${e.fiscal_regime_tributario === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="campo"><label>CNAE principal</label><input id="${id("cnae")}" value="${v(e.fiscal_cnae)}" placeholder="0000-0/00" /></div>
      <div class="campo"><label>Código de serviço municipal</label><input id="${id("codserv")}" value="${v(e.fiscal_codigo_servico)}" placeholder="lista do município (Itabira)" /></div>
      <div class="campo"><label>Item da LC 116</label><input id="${id("lc116")}" value="${v(e.fiscal_item_lc116 || "7.02")}" placeholder="7.02" title="Fundações = 7.02" /></div>
      <div class="campo"><label>ISS padrão (%)</label><input id="${id("iss")}" type="number" min="0" max="5" step="0.01" value="${v(e.fiscal_iss_aliquota)}" title="Referência para obra nova; a medição usa o ISS do município da obra (aba Parâmetros)" /></div>
      <div class="campo"><label>Série da NF-e</label><input id="${id("nfe-serie")}" value="${v(e.fiscal_nfe_serie)}" placeholder="ex.: 1" /></div>
      <div class="campo"><label>Próximo número da NF-e</label><input id="${id("nfe-num")}" type="number" min="1" step="1" value="${v(e.fiscal_nfe_proximo_numero)}" title="O seguinte ao último emitido na UniNFe" /></div>
      <div class="campo"><label>Série da NFS-e</label><input id="${id("nfse-serie")}" value="${v(e.fiscal_nfse_serie)}" /></div>
      <div class="campo"><label>Próximo número da NFS-e</label><input id="${id("nfse-num")}" type="number" min="1" step="1" value="${v(e.fiscal_nfse_proximo_numero)}" /></div>
      <div class="campo"><label>Ambiente</label><select id="${id("ambiente")}"><option value="homologacao" ${amb === "homologacao" ? "selected" : ""}>Homologação (teste, sem valor fiscal)</option><option value="producao" ${amb === "producao" ? "selected" : ""}>Produção</option></select></div>
      <div class="campo largo"><label>E-mail do contador</label><input id="${id("contador")}" type="email" value="${v(e.fiscal_contador_email)}" /></div>
    </div>
    ${tem105b ? fiscalEmpresaHtml105b(pref, e) : ""}
    <div class="form-acoes compacta">
      <button type="button" class="btn" id="${id("salvar")}"${pode ? "" : ' style="display:none;"'}>💾 Salvar dados fiscais</button>
    </div>
    ${tem105b ? fiscalCertificadoHtml(pref, e, pode) : ""}`;
  box.querySelectorAll("input,select,textarea").forEach(el => { el.disabled = !pode; });
  const bs = $(id("salvar"));
  if(bs && pode) bs.addEventListener("click", () => comBotaoTravado(id("salvar"), () => fiscalEmpresaSalvar(pref)));
  if(tem105b) fiscalCertificadoLigar(pref);
}

/* ---------- Fase 105b: NF-e de remessa e retorno (campos da empresa) ---------- */
const FISCAL_CST_SUGESTOES = [["41", "não tributada (regime normal)"], ["50", "suspensão (regime normal)"], ["90", "outras (regime normal)"], ["400", "não tributada pelo Simples (CSOSN)"], ["900", "outras do Simples (CSOSN)"]];
function fiscalEmpresaHtml105b(pref, e){
  const id = s => `${pref}-${s}`;
  const v = x => esc(x == null ? "" : x);
  const uf = String(e.fiscal_uf || "").toUpperCase();
  return `<h3 class="titulo-bloco">NF-e de remessa e retorno (fase 105b)</h3>
    <p class="nota">Sem destaque de ICMS. O contador define CST/CSOSN, CFOPs e o texto legal antes da primeira nota; item com CFOP próprio usa o dele.</p>
    <div class="grade">
      <div class="campo"><label>UF da sede</label><select id="${id("uf")}"><option value="">—</option>${UFS.map(u => `<option value="${u.toLowerCase()}" ${uf === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
      <div class="campo"><label>Município da sede (IBGE)</label><input id="${id("mun")}" maxlength="7" value="${v(e.fiscal_codigo_municipio)}" placeholder="3131703 = Itabira" /></div>
      <div class="campo"><label>CST/CSOSN do ICMS</label><input id="${id("cst")}" maxlength="3" list="${id("cst-lista")}" value="${v(e.fiscal_cst_icms_remessa)}" placeholder="41 (normal) ou 400 (Simples)" />
        <datalist id="${id("cst-lista")}">${FISCAL_CST_SUGESTOES.map(([c, t]) => `<option value="${c}">${esc(t)}</option>`).join("")}</datalist></div>
      <div class="campo"><label>CST PIS/COFINS na remessa</label><input id="${id("pis-rem")}" maxlength="2" value="${v(e.fiscal_cst_pis_cofins_remessa)}" placeholder="49" title="49 = outras operações de saída" /></div>
      <div class="campo"><label>CST PIS/COFINS no retorno</label><input id="${id("pis-ret")}" maxlength="2" value="${v(e.fiscal_cst_pis_cofins_retorno)}" placeholder="98" title="98 = outras operações de entrada" /></div>
      <div class="campo"><label>CFOP remessa dentro da UF</label><input id="${id("cfop-rd")}" maxlength="4" value="${v(e.fiscal_cfop_remessa_dentro_uf)}" placeholder="5949" /></div>
      <div class="campo"><label>CFOP remessa fora da UF</label><input id="${id("cfop-rf")}" maxlength="4" value="${v(e.fiscal_cfop_remessa_fora_uf)}" placeholder="6949" /></div>
      <div class="campo"><label>CFOP retorno dentro da UF</label><input id="${id("cfop-td")}" maxlength="4" value="${v(e.fiscal_cfop_retorno_dentro_uf)}" placeholder="1949" /></div>
      <div class="campo"><label>CFOP retorno fora da UF</label><input id="${id("cfop-tf")}" maxlength="4" value="${v(e.fiscal_cfop_retorno_fora_uf)}" placeholder="2949" /></div>
      <div class="campo"><label>IBS/CBS: CST</label><input id="${id("ibs-cst")}" maxlength="3" value="${v(e.fiscal_ibs_cbs_cst_remessa)}" placeholder="vazio = sem o grupo" title="Reforma tributária: 3 dígitos; vazio, a nota vai sem o grupo IBS/CBS" /></div>
      <div class="campo"><label>IBS/CBS: classificação</label><input id="${id("ibs-class")}" maxlength="6" value="${v(e.fiscal_ibs_cbs_cclass_remessa)}" placeholder="6 dígitos (cClassTrib)" /></div>
      <div class="campo largo"><label>Texto legal (informações complementares)</label><textarea id="${id("texto-legal")}" rows="2" maxlength="2000" placeholder="ex.: base legal da não incidência do ICMS na remessa para prestação de serviço">${v(e.fiscal_texto_legal_remessa)}</textarea></div>
    </div>`;
}
/* campos da 105b no salvar: null = colunas ainda não existem; { erro } = valor inválido */
function fiscalEmpresaValores105b(pref){
  if(!$(`${pref}-cfop-rd`)) return null;
  const g = s => ($(`${pref}-${s}`)?.value || "").trim();
  const reg = {
    fiscal_uf: g("uf") || null,
    fiscal_codigo_municipio: g("mun").replace(/\D/g, "") || null,
    fiscal_cst_icms_remessa: g("cst").replace(/\D/g, "") || null,
    fiscal_cst_pis_cofins_remessa: g("pis-rem").replace(/\D/g, "") || "49",
    fiscal_cst_pis_cofins_retorno: g("pis-ret").replace(/\D/g, "") || "98",
    fiscal_cfop_remessa_dentro_uf: g("cfop-rd").replace(/\D/g, "") || "5949",
    fiscal_cfop_remessa_fora_uf: g("cfop-rf").replace(/\D/g, "") || "6949",
    fiscal_cfop_retorno_dentro_uf: g("cfop-td").replace(/\D/g, "") || "1949",
    fiscal_cfop_retorno_fora_uf: g("cfop-tf").replace(/\D/g, "") || "2949",
    fiscal_ibs_cbs_cst_remessa: g("ibs-cst").replace(/\D/g, "") || null,
    fiscal_ibs_cbs_cclass_remessa: g("ibs-class").replace(/\D/g, "") || null,
    fiscal_texto_legal_remessa: g("texto-legal") || null
  };
  const erros = [];
  if(reg.fiscal_codigo_municipio && !/^\d{7}$/.test(reg.fiscal_codigo_municipio)) erros.push("município da sede com 7 dígitos (IBGE)");
  if(reg.fiscal_cst_icms_remessa && !/^\d{2,3}$/.test(reg.fiscal_cst_icms_remessa)) erros.push("CST (2 dígitos) ou CSOSN (3 dígitos) do ICMS");
  if(!/^\d{2}$/.test(reg.fiscal_cst_pis_cofins_remessa) || !/^\d{2}$/.test(reg.fiscal_cst_pis_cofins_retorno)) erros.push("CST de PIS/COFINS com 2 dígitos");
  [["fiscal_cfop_remessa_dentro_uf", "5", "remessa dentro da UF"], ["fiscal_cfop_remessa_fora_uf", "6", "remessa fora da UF"],
   ["fiscal_cfop_retorno_dentro_uf", "1", "retorno dentro da UF"], ["fiscal_cfop_retorno_fora_uf", "2", "retorno fora da UF"]].forEach(([k, ini, t]) => {
    if(!new RegExp(`^${ini}\\d{3}$`).test(reg[k])) erros.push(`CFOP de ${t} começa com ${ini} (4 dígitos)`);
  });
  if(!!reg.fiscal_ibs_cbs_cst_remessa !== !!reg.fiscal_ibs_cbs_cclass_remessa) erros.push("IBS/CBS: CST e classificação juntos (ou os dois vazios)");
  if(reg.fiscal_ibs_cbs_cst_remessa && !/^\d{3}$/.test(reg.fiscal_ibs_cbs_cst_remessa)) erros.push("CST do IBS/CBS com 3 dígitos");
  if(reg.fiscal_ibs_cbs_cclass_remessa && !/^\d{6}$/.test(reg.fiscal_ibs_cbs_cclass_remessa)) erros.push("classificação do IBS/CBS com 6 dígitos");
  return erros.length ? { erro: erros.join("; ") } : reg;
}

/* ---------- Fase 105b: chamada da function focus-nfe ----------
   Devolve { data } ou { erro, corpo } com a mensagem real da function (FunctionsHttpError traz o corpo em error.context). */
async function fiscalChamarFocus(acao, corpo){
  try {
    const { data, error } = await sb.functions.invoke("focus-nfe", { body: { acao, ...(corpo || {}) } });
    if(error){
      let msg = error.message || "erro", det = null;
      try { det = await error.context?.json(); if(det?.error) msg = det.error; } catch(_e){}
      return { erro: msg, corpo: det || {} };
    }
    return { data: data || {} };
  } catch(e){
    return { erro: e.message || String(e), corpo: {} };
  }
}

/* ---------- Fase 105b: certificado A1 e webhook da Focus ----------
   O arquivo (.pfx/.p12) é lido no navegador em base64 e vai, com a senha, direto para a function focus-nfe, que repassa à
   Focus (API de Empresas). Nada disso é gravado no banco, em log ou no console; o app guarda só a validade. Envio só pelo
   diretor (decisão 2); consulta da validade e registro do webhook por quem emite. */
function fiscalCertificadoHtml(pref, e, pode){
  const id = s => `${pref}-${s}`;
  const diretor = !!usuarioAtual && usuarioAtual.cargo === "diretor";
  const val = e.fiscal_certificado_validade;
  const vencido = val && String(val).slice(0, 10) < hojeISO();
  const hook = e.fiscal_focus_webhook_registrado_em;
  return `<h3 class="titulo-bloco">Certificado digital A1 e webhook da Focus NFe</h3>
    <div class="grade">
      <div class="campo"><label>Validade do certificado</label><div>${val ? `${dataBR(val)} <span class="tag ${vencido ? "vermelho" : "verde"}">${vencido ? "vencido" : "válido"}</span>` : '<span class="meta">não enviado</span>'}</div></div>
      <div class="campo"><label>Enviado à Focus em</label><div>${e.fiscal_certificado_enviado_em ? esc(dataBR(e.fiscal_certificado_enviado_em)) : '<span class="meta">—</span>'}</div></div>
      <div class="campo"><label>Webhook de NF-e</label><div>${hook ? `registrado em ${esc(dataBR(hook))} <span class="tag ${e.fiscal_focus_webhook_ambiente === "producao" ? "verde" : "ambar"}">${e.fiscal_focus_webhook_ambiente === "producao" ? "produção" : "homologação"}</span>` : '<span class="meta">não registrado</span>'}</div></div>
    </div>
    ${diretor ? `<div class="grade">
      <div class="campo"><label>Arquivo do certificado (.pfx ou .p12)</label><input type="file" id="${id("cert-arq")}" accept=".pfx,.p12" /></div>
      <div class="campo"><label>Senha do certificado</label><input type="password" id="${id("cert-senha")}" autocomplete="new-password" /></div>
    </div>` : ""}
    <div class="form-acoes compacta">
      ${diretor ? `<button type="button" class="btn" id="${id("cert-enviar")}">🔐 Enviar certificado à Focus</button>` : ""}
      ${pode ? `<button type="button" class="btn-sec" id="${id("cert-status")}">Consultar validade</button>
      <button type="button" class="btn-sec" id="${id("webhook")}" title="Registra na Focus o aviso automático de status das notas (ambiente atual)">Registrar webhook</button>` : ""}
    </div>
    <p class="nota">O arquivo e a senha vão direto para a Focus pela função do servidor e não ficam guardados no app; fica só a validade. O webhook é registrado por ambiente: ao virar para produção, registre de novo.</p>`;
}
function fiscalCertificadoLigar(pref){
  const id = s => `${pref}-${s}`;
  $(id("cert-enviar"))?.addEventListener("click", () => comBotaoTravado(id("cert-enviar"), () => fiscalCertificadoEnviar(pref)));
  $(id("cert-status"))?.addEventListener("click", () => comBotaoTravado(id("cert-status"), async () => {
    const r = await fiscalChamarFocus("certificado_status");
    if(r.erro){ aviso("app-aviso", "Certificado: " + r.erro, "erro"); return; }
    aviso("app-aviso", r.data.validade ? `Certificado válido até ${dataBR(r.data.validade)}.` : "A Focus não informou a validade do certificado.", r.data.validade ? "ok" : "erro");
    await fiscalEmpresaRender(pref);
  }));
  $(id("webhook"))?.addEventListener("click", () => comBotaoTravado(id("webhook"), async () => {
    const r = await fiscalChamarFocus("webhook_registrar");
    if(r.erro){ aviso("app-aviso", "Webhook: " + r.erro, "erro"); return; }
    aviso("app-aviso", r.data.mensagem || "Webhook registrado.", "ok");
    await fiscalEmpresaRender(pref);
  }));
}
function fiscalLerArquivoBase64(arquivo){
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result || "").replace(/^data:[^,]*,/, ""));
    leitor.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}
async function fiscalCertificadoEnviar(pref){
  const inpArq = $(`${pref}-cert-arq`), inpSenha = $(`${pref}-cert-senha`);
  const arquivo = inpArq?.files?.[0];
  if(!arquivo){ aviso("app-aviso", "Escolha o arquivo do certificado (.pfx ou .p12).", "erro"); return; }
  if(!/\.(pfx|p12)$/i.test(arquivo.name)){ aviso("app-aviso", "O certificado A1 é um arquivo .pfx ou .p12.", "erro"); return; }
  if(arquivo.size > 150 * 1024){ aviso("app-aviso", "Arquivo grande demais para um certificado A1 (até 150 KB).", "erro"); return; }
  if(!inpSenha?.value){ aviso("app-aviso", "Informe a senha do certificado.", "erro"); return; }
  if(!confirm("Enviar o certificado A1 da CGL para a Focus NFe? O arquivo e a senha não ficam guardados no app.")) return;
  let r;
  try {
    const base64 = await fiscalLerArquivoBase64(arquivo);
    r = await fiscalChamarFocus("certificado_enviar", { arquivo_base64: base64, senha: inpSenha.value });
  } catch(e){
    r = { erro: e.message || "falha ao ler o arquivo" };
  } finally {
    // arquivo e senha saem da tela em qualquer caso
    if(inpArq) inpArq.value = "";
    if(inpSenha) inpSenha.value = "";
  }
  if(r.erro){
    const det = (r.corpo?.erros || []).map(x => x.mensagem).filter(Boolean).join("; ");
    aviso("app-aviso", "Certificado não enviado: " + r.erro + (det && !r.erro.includes(det) ? " (" + det + ")" : ""), "erro");
    return;
  }
  aviso("app-aviso", `Certificado enviado à Focus${r.data.validade ? `: válido até ${dataBR(r.data.validade)}` : ""}${r.data.cnpj_confere === false ? ". ATENÇÃO: o CNPJ do certificado não é o da empresa." : "."}`, r.data.cnpj_confere === false ? "erro" : "ok");
  await fiscalEmpresaRender(pref);
}
async function fiscalEmpresaSalvar(pref){
  if(!(typeof podeEmitirFiscal === "function" && podeEmitirFiscal())){ aviso("app-aviso", "Seu cargo só consulta os dados fiscais da empresa.", "erro"); return; }
  const g = s => ($(`${pref}-${s}`)?.value || "").trim();
  const inteiro = s => { const t = g(s); return t === "" ? null : Number(t); };
  const cnpj = fiscalDocLimpo(g("cnpj"));
  const cnae = g("cnae").replace(/\D/g, "");
  const reg = {
    fiscal_cnpj: cnpj || null,
    fiscal_razao_social: g("razao") || null,
    fiscal_ie: g("ie") || null,
    fiscal_im: g("im") || null,
    fiscal_regime_tributario: g("regime") || null,
    fiscal_cnae: cnae || null,
    fiscal_codigo_servico: g("codserv") || null,
    fiscal_item_lc116: g("lc116") || "7.02",
    fiscal_iss_aliquota: g("iss") === "" ? null : Number(g("iss").replace(",", ".")),
    fiscal_nfe_serie: g("nfe-serie") || null,
    fiscal_nfe_proximo_numero: inteiro("nfe-num"),
    fiscal_nfse_serie: g("nfse-serie") || null,
    fiscal_nfse_proximo_numero: inteiro("nfse-num"),
    fiscal_ambiente: g("ambiente") || "homologacao",
    fiscal_contador_email: g("contador") || null
  };
  const erros = [];
  if(reg.fiscal_cnpj && (reg.fiscal_cnpj.length !== 14 || !fiscalDocValido(reg.fiscal_cnpj))) erros.push("CNPJ inválido (confira os dígitos)");
  if(reg.fiscal_cnae && reg.fiscal_cnae.length !== 7) erros.push("CNAE com 7 dígitos (ex.: 4391-6/00)");
  if(!/^\d{1,2}\.\d{2}$/.test(reg.fiscal_item_lc116)) erros.push("item da LC 116 no formato 7.02");
  if(reg.fiscal_iss_aliquota != null && !(reg.fiscal_iss_aliquota >= 0 && reg.fiscal_iss_aliquota <= 5)) erros.push("ISS entre 0 e 5%");
  if(reg.fiscal_nfe_serie && !/^\d{1,3}$/.test(reg.fiscal_nfe_serie)) erros.push("série da NF-e com até 3 dígitos");
  if(reg.fiscal_nfse_serie && !/^[0-9A-Za-z]{1,5}$/.test(reg.fiscal_nfse_serie)) erros.push("série da NFS-e com até 5 letras ou dígitos");
  [["fiscal_nfe_proximo_numero", "NF-e"], ["fiscal_nfse_proximo_numero", "NFS-e"]].forEach(([k, t]) => {
    const n = reg[k]; if(n != null && !(Number.isInteger(n) && n >= 1 && n <= 999999999)) erros.push(`próximo número da ${t} inteiro a partir de 1`);
  });
  if(reg.fiscal_contador_email && !fiscalEmailsValidos(reg.fiscal_contador_email)) erros.push("e-mail do contador");
  const reg105b = fiscalEmpresaValores105b(pref);   // fase 105b: null sem a migration
  if(reg105b && reg105b.erro) erros.push(reg105b.erro);
  else if(reg105b) Object.assign(reg, reg105b);
  if(erros.length){ aviso("app-aviso", "Confira: " + erros.join("; ") + ".", "erro"); return; }
  const antes = _fiscalEmpresa[pref] || {};
  if(reg.fiscal_ambiente === "producao" && antes.fiscal_ambiente !== "producao"
     && !confirm("Trocar para PRODUÇÃO: as notas emitidas pelo app passam a ter valor fiscal na SEFAZ e na prefeitura. Só depois das remessas de teste conferidas em homologação. Confirmar?")) return;
  const { error } = await sb.from("empresa_config").update({ ...reg, updated_at: new Date().toISOString() }).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar os dados fiscais: " + error.message, "erro"); return; }
  aviso("app-aviso", "Dados fiscais da empresa salvos.", "ok");
  // as duas telas que mostram o bloco ficam iguais
  await Promise.all(["usr-fe", "cli-fe"].map(p => $(p) && $(p).innerHTML ? fiscalEmpresaRender(p) : null));
}

/* ---------- Cliente: o que falta para a nota ---------- */
function fiscalClientePendencias(c){
  if(!c) return [];
  const vazio = v => v == null || String(v).trim() === "";
  return [
    !fiscalDocValido(c.cpf_cnpj) && (vazio(c.cpf_cnpj) ? "sem CNPJ/CPF" : "CNPJ/CPF inválido"),
    (vazio(c.indicador_ie) && "indicador da IE") || (c.indicador_ie === "contribuinte" && vazio(c.inscricao_estadual) && "IE"),
    vazio(c.cep) && "CEP",
    vazio(c.codigo_ibge) && "código IBGE"
  ].filter(Boolean);
}

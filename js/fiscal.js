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
    (vazio(e.fiscal_nfse_serie) || vazio(e.fiscal_nfse_proximo_numero)) && "série/número da NFS-e"
  ].filter(Boolean);
}
async function fiscalEmpresaRender(pref){
  const box = $(pref);
  if(!box) return;
  const { data, error } = await sb.from("empresa_config").select(FISCAL_EMPRESA_COLS).eq("id", 1).maybeSingle();
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
    <div class="form-acoes compacta">
      <button type="button" class="btn" id="${id("salvar")}"${pode ? "" : ' style="display:none;"'}>💾 Salvar dados fiscais</button>
    </div>`;
  box.querySelectorAll("input,select").forEach(el => { el.disabled = !pode; });
  const bs = $(id("salvar"));
  if(bs && pode) bs.addEventListener("click", () => comBotaoTravado(id("salvar"), () => fiscalEmpresaSalvar(pref)));
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

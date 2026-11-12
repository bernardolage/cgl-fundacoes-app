/* ====================================================================
   FASE 177a (12/11/2026) — CARGA QUE RECUSA LIXO
   Regras únicas para a tela "Importar boletim (PDF)" (js/medicoes.js) e para scripts/carregar-medicoes-pastas.js
   (que usa este arquivo por require). Spec: docs/specs/fase-177-dado-com-dono-e-prazo.md, seção 177a.

   Quem decide é o banco: a RPC medicao_conferir_carga aplica R0 a R6 e diz o status de nascimento (R7). Este
   módulo monta a entrada da RPC a partir da leitura da IA, calcula o SHA-256 do PDF e, quando a RPC ainda não
   existe no banco (antes do "pode fechar 177a"), confere com a mesma regra aqui (conferirLocal), só para a
   conferência do script; gravar sempre exige a RPC.

   R0 número repetido na obra · R1 modelo em branco ou quebrado · R2 arquivo repetido (SHA-256) · R3 calculado ≠
   impresso (sem linha de ajuste) · R4 período sobreposto (obra ou contrato; mesma TAG ou sem TAG) · R5 NF repetida
   · R6 acima do contrato · R7 nasce rascunho sem prova de envio (enviada com prova, 177c), nunca aprovada.
   Recusa = pendência de revisão em medicao_carga_pendencias (na 177b vira proposta); nada é gravado em medicoes.
   ==================================================================== */
(function(raiz){
  "use strict";

  const ERRO_PLANILHA = /#(REF!|VALOR!|VALUE!|DIV\/0!|N\/D)/i;
  const NOME_MODELO = /RG[\s_-]*11[.,][46]/i;
  const NOME_COM_NUMERO = /(medi[çc][ãa]o|bm|boletim)[\s_.-]*0*\d/i;
  const NOME_COM_TAG = /(tag|hc|h[ée]lice|trado|raiz|secante)[\s_-]*\d{2,3}/i;
  const STATUS_FORA = ["rejeitada"];

  const num = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tolerancia = (impresso) => Math.max(100, Math.abs(Number(impresso) || 0) * 0.005);   // a de hoje (R$ 100 ou 0,5 %)
  const tagNum = (s) => { const m = String(s || "").match(/0*(\d+)/); return m ? m[1] : null; };
  const tagDoNumero = (numero) => { const m = String(numero || "").match(/tag\s*0*(\d+)/i); return m ? m[1] : null; };
  const tagDoEquip = (codigo) => { const m = String(codigo || "").match(/^0*(\d+)/); return m ? m[1] : null; };
  const nfsDoTexto = (s) => String(s || "").split(/[^0-9]+/).filter(Boolean).map(t => t.replace(/^0+/, "") || "0");

  function nomeDeModelo(nome){ const n = String(nome || ""); return NOME_MODELO.test(n) && !NOME_COM_NUMERO.test(n) && !NOME_COM_TAG.test(n); }
  function temErroPlanilha(texto){ return ERRO_PLANILHA.test(String(texto || "")); }

  /* Entrada da RPC a partir do que a IA leu (resp de extrair-medicao-pdf) e do que a tela ou o script já decidiu.
     dados: { obraId, contratoId, numero, tag, arquivoNome, sha256, periodoInicio, periodoFim, dataMedicao, tipoMedicao,
              valorCalculado, valorImpresso, itens, acrescimoDescricao, nfs, origem, temProvaEnvio, ignorarMedicaoId } */
  function montarEntrada(resp, dados){
    const r = resp || {}, m = r.medicao || {}, d = dados || {};
    const itens = (d.itens || r.itens || []).map(it => ({ descricao: it.descricao || "", quantidade: num(it.quantidade), valor_total: num(it.valor_total) }));
    const texto = [m.observacoes, r.observacoes, ...(r.duvidas || []), r.parece_modelo_motivo, ...itens.map(it => it.descricao)].filter(Boolean).join(" · ").slice(0, 8000);
    return {
      obra_id: d.obraId, contrato_id: d.contratoId || null, numero: d.numero || null,
      tag: d.tag != null ? String(d.tag) : null,
      arquivo_nome: d.arquivoNome || null, arquivo_sha256: d.sha256 || null,
      periodo_inicio: d.periodoInicio !== undefined ? d.periodoInicio : (m.periodo_inicio || null),
      periodo_fim: d.periodoFim !== undefined ? d.periodoFim : (m.periodo_fim || null),
      data_medicao: d.dataMedicao !== undefined ? d.dataMedicao : (m.data || null),
      tipo_medicao: d.tipoMedicao || m.tipo_medicao || "quinzenal",
      valor_calculado: num(d.valorCalculado), valor_impresso: d.valorImpresso !== undefined ? num(d.valorImpresso) : num(m.valor_final),
      itens, texto, acrescimo_descricao: d.acrescimoDescricao || null,
      parece_modelo: r.parece_modelo === true, parece_modelo_motivo: r.parece_modelo_motivo || null,
      nfs: (d.nfs || []).filter(n => n && n.numero), origem: d.origem || "tela_pdf",
      tem_prova_envio: d.temProvaEnvio === true, ignorar_medicao_id: d.ignorarMedicaoId || null
    };
  }

  /* Mesma regra da RPC, com os dados carregados por quem chama (só para conferir antes da migration estar no banco).
     ctx: { obraCodigo, contratoId, medicoes: [{ id, obra_id, obra_codigo, numero, status, periodo_inicio, periodo_fim,
            contrato_id, em_revisao, valor_final, valor_medido, nf_numero, arquivo_sha256, equip_codigo }],
            nfs: [{ medicao_id, numero, serie, valor, valor_parte, situacao }], valorVigente } */
  function conferirLocal(e, ctx){
    const c = ctx || {}, meds = (c.medicoes || []).filter(m => m.id !== e.ignorar_medicao_id), rec = [];
    const add = (regra, motivo, extra) => rec.push(Object.assign({ regra, motivo }, extra || {}));
    const numero = (e.numero || "").trim();
    const contrato = e.contrato_id || c.contratoId || null;
    const ref = (m) => ({ obra: m.obra_codigo, numero: m.numero, status: m.status, medicao_id: m.id });
    // R0
    if(numero){
      const mesmos = meds.filter(m => m.obra_id === e.obra_id && String(m.numero).trim().toLowerCase() === numero.toLowerCase());
      if(mesmos.length) add("R0", `A medição ${numero} já existe nesta obra`, { conflitos: mesmos.map(ref) });
    }
    // R1
    if(temErroPlanilha(e.texto)) add("R1", "Planilha com erro de fórmula (#REF!, #VALOR!, #DIV/0! ou #N/D) no que foi lido: modelo quebrado");
    if(!e.periodo_inicio && !e.periodo_fim && !e.data_medicao) add("R1", "Sem período nem data da medição: parece modelo em branco");
    if(nomeDeModelo(e.arquivo_nome)) add("R1", `Nome de modelo ("${e.arquivo_nome}"): RG 11.4/11.6 sem número de medição nem TAG`);
    const medidos = (e.itens || []).filter(it => (it.quantidade || 0) > 0 || (it.valor_total || 0) > 0);
    if(medidos.length === 1 && /mobiliza/i.test(medidos[0].descricao) && (medidos[0].quantidade == null || medidos[0].quantidade === 1))
      add("R1", "A única linha medida é mobilização × 1: parece modelo em branco");
    if(e.parece_modelo) add("R1", "A leitura por IA indica modelo em branco" + (e.parece_modelo_motivo ? ": " + e.parece_modelo_motivo : ""));
    // R2
    if(e.arquivo_sha256){
      const iguais = meds.filter(m => m.arquivo_sha256 && m.arquivo_sha256 === String(e.arquivo_sha256).toLowerCase());
      if(iguais.length) add("R2", "O mesmo arquivo já está gravado em " + iguais.map(m => `${m.obra_codigo} medição ${m.numero}`).join("; "), { conflitos: iguais.map(ref) });
    }
    // R3
    if(e.valor_calculado != null && e.valor_impresso != null && e.tipo_medicao !== "sinal_contratual"
       && Math.abs(e.valor_calculado - e.valor_impresso) > tolerancia(e.valor_impresso))
      add("R3", `Valor calculado dos itens (R$ ${brl(e.valor_calculado)}) diferente do total impresso (R$ ${brl(e.valor_impresso)}): uma pessoa escolhe qual vale; sem linha de ajuste`,
          { valor_calculado: e.valor_calculado, valor_impresso: e.valor_impresso });
    if(/ajuste ao total impresso/i.test(e.acrescimo_descricao || "")) add("R3", 'Linha "Ajuste ao total impresso" não é mais aceita');
    // R4
    if(e.periodo_inicio || e.periodo_fim){
      const a0 = e.periodo_inicio || e.periodo_fim, b0 = e.periodo_fim || e.periodo_inicio;
      const a = a0 < b0 ? a0 : b0, b = a0 < b0 ? b0 : a0;
      const tag = tagNum(e.tag) || tagDoNumero(numero);
      const cruzam = meds.filter(m => {
        if(!(m.obra_id === e.obra_id || (contrato && m.contrato_id === contrato))) return false;
        if(STATUS_FORA.includes(m.status)) return false;
        if(!m.periodo_inicio && !m.periodo_fim) return false;
        if(m.obra_id === e.obra_id && numero && String(m.numero).trim().toLowerCase() === numero.toLowerCase()) return false;
        const i0 = m.periodo_inicio || m.periodo_fim, f0 = m.periodo_fim || m.periodo_inicio;
        const i = i0 < f0 ? i0 : f0, f = i0 < f0 ? f0 : i0;
        if(!(i <= b && f >= a)) return false;
        const mt = tagDoNumero(m.numero) || tagDoEquip(m.equip_codigo);
        return !tag || !mt || mt === tag;
      });
      if(cruzam.length){
        const dm = (s) => s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "?";
        add("R4", `Período ${a.split("-").reverse().join("/")} a ${b.split("-").reverse().join("/")} cruza o de ${cruzam.length} medição(ões) da obra ou do contrato: ` +
            cruzam.map(m => `${m.obra_codigo} ${m.numero} (${dm(m.periodo_inicio)} a ${dm(m.periodo_fim)})`).join("; "),
            { conflitos: cruzam.map(m => Object.assign(ref(m), { periodo_inicio: m.periodo_inicio, periodo_fim: m.periodo_fim, em_revisao: !!m.em_revisao, valor_final: m.valor_final })) });
      }
    }
    // R5
    (e.nfs || []).forEach(nf => {
      const n = tagNum(nf.numero); if(!n) return;
      const lista = (c.nfs || []).filter(x => (String(x.numero).replace(/^0+/, "") === n) && (x.serie || "") === (nf.serie || "") && x.situacao === "emitida" && x.medicao_id !== e.ignorar_medicao_id);
      const comLista = new Set((c.nfs || []).map(x => x.medicao_id));
      const antigas = meds.filter(m => m.nf_numero && !comLista.has(m.id) && nfsDoTexto(m.nf_numero).includes(n));
      if(!lista.length && !antigas.length) return;
      const soma = lista.reduce((s, x) => s + (Number(x.valor_parte) || 0), 0);
      const bate = lista.every(x => x.valor != null && Number(x.valor) === Number(nf.valor) && x.valor_parte != null);
      if(antigas.length || nf.valor == null || nf.valor_parte == null || !bate || Math.abs(soma + Number(nf.valor_parte) - Number(nf.valor)) > 0.01)
        add("R5", `NF ${n} já está em ${lista.length + antigas.length} outra(s) medição(ões) e a soma das partes não fecha com o valor da NF`,
            { conflitos: [...lista.map(x => ({ medicao_id: x.medicao_id, nf: x.numero, valor_nf: x.valor, valor_parte: x.valor_parte })), ...antigas.map(m => Object.assign(ref(m), { nf_numero: m.nf_numero }))] });
    });
    // R6
    const valor = e.valor_impresso != null ? e.valor_impresso : e.valor_calculado;
    if(valor > 0 && Number(c.valorVigente) > 0){
      const base = meds.filter(m => (contrato ? m.contrato_id === contrato : m.obra_id === e.obra_id) && !STATUS_FORA.includes(m.status) && !m.em_revisao);
      const acum = base.reduce((s, m) => s + (Number(m.valor_final != null ? m.valor_final : m.valor_medido) || 0), 0);
      if(acum + valor > Number(c.valorVigente) + 0.01)
        add("R6", `Acima do contrato: falta aditivo? Já medido R$ ${brl(acum)} + esta R$ ${brl(valor)} = R$ ${brl(acum + valor)}, contra R$ ${brl(c.valorVigente)} vigentes`,
            { valor_vigente: Number(c.valorVigente), acumulado: acum });
    }
    return { ok: rec.length === 0, recusas: rec, pendencia_id: null, status_nascimento: e.tem_prova_envio ? "enviada" : "rascunho", fonte: "local" };
  }

  /* Confere pela RPC (registrar = grava a recusa em medicao_carga_pendencias). rpc(nome, args) devolve { data, error }
     como o supabase-js. Sem a RPC no banco e com ctxLocal, cai na conferência local (fonte "local", nada registrado). */
  async function conferir(entrada, opcoes){
    const o = opcoes || {};
    const { data, error } = await o.rpc("medicao_conferir_carga", { p: entrada, p_registrar: !!o.registrar });
    if(!error) return Object.assign({ fonte: "banco" }, data);
    const semRpc = /PGRST202|could not find the function|does not exist|404/i.test(`${error.code || ""} ${error.message || ""}`);
    if(semRpc && o.ctxLocal) return conferirLocal(entrada, o.ctxLocal);
    throw new Error("Conferência da carga falhou: " + (error.message || error));
  }

  /* SHA-256 em hexa (navegador: crypto.subtle; Node: crypto) */
  async function sha256Hex(dados){
    if(typeof require === "function" && typeof window === "undefined"){
      return require("crypto").createHash("sha256").update(Buffer.isBuffer(dados) ? dados : Buffer.from(dados)).digest("hex");
    }
    const buf = dados instanceof ArrayBuffer ? dados : (dados.buffer ? dados.buffer : await new Response(dados).arrayBuffer());
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* Uma linha por recusa: "R4: Período … cruza …" */
  function textoRecusas(res){ return ((res && res.recusas) || []).map(r => `${r.regra}: ${r.motivo}`); }

  const api = { nomeDeModelo, temErroPlanilha, tolerancia, montarEntrada, conferirLocal, conferir, sha256Hex, textoRecusas };
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.MedRegrasCarga = api;
})(typeof window !== "undefined" ? window : globalThis);

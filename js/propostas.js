
















const CGL_INFO = {
  razao_social: "CGL FUNDAÇÕES LTDA",
  endereco:     "AVENIDA HEMATITA, 562 – DISTRITO INDUSTRIAL - ITABIRA / MG",
  telefone:     "(31) 3833-4100",
  emails:       "sergio@cglfundacoes.com.br / bernardo@cglfundacoes.com.br / vitorhugo@cglfundacoes.com.br",
  site:         "www.cglfundacoes.com.br"
};



function obterLogoHTML(){
  return pdfCabecalhoHTML();
}


const PROPOSTA_TIPOS = {
  helice:  { rotulo: "HÉLICE",  codigo: "RG 11.8",  revisao_padrao: "01 - 03/06/2024" },
  trado:   { rotulo: "TRADO",   codigo: "RG 11.9",  revisao_padrao: "01 - 03/06/2024" },
  raiz:    { rotulo: "RAÍZ",    codigo: "RG 11.10", revisao_padrao: "01 - 03/06/2024" },
  secante: { rotulo: "SECANTE", codigo: "RG 11.11", revisao_padrao: "01 - 03/06/2024" },
  outro:   { rotulo: "PROPOSTA",codigo: "RG 11.0",  revisao_padrao: "01" }
};





const PROPOSTA_TIPO_ARQ = { helice: "HELICE", trado: "TRADO", raiz: "RAIZ", secante: "SECANTE" };
function propostaNomeArquivo(orc, cliente){
  const o = orc || {}, c = cliente || {};
  const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const p = orcNumeroPartes(o.numero, o.data_orcamento);
  const partes = [`${p.num || "0000"}-${p.ano}`, semAcento(c.nome_fantasia || c.nome).trim().toUpperCase(),
    PROPOSTA_TIPO_ARQ[o.tipo_proposta] || ""].filter(Boolean);
  return partes.join(" - ").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim() + ".pdf";
}







const PRAZOS_PAGAMENTO_EXTENSO = { 5: "cinco", 7: "sete", 10: "dez", 15: "quinze", 20: "vinte", 21: "vinte e um", 28: "vinte e oito", 30: "trinta", 45: "quarenta e cinco", 60: "sessenta", 90: "noventa" };
function textoPagamentoPadrao(prazoDias, forma){
  const n = Number(prazoDias) > 0 ? Number(prazoDias) : 15;
  const ext = PRAZOS_PAGAMENTO_EXTENSO[n];
  const prazo = `${String(n).padStart(2, "0")}${ext ? ` (${ext})` : ""} dias corridos`;
  const meio = forma === "boleto" ? "boleto bancário" : "depósito bancário";
  return "Sinal Contratual correspondente a 30% do valor contratual, com medição realizada no ato da assinatura do contrato. " +
    "O pagamento deverá ser realizado em até 03 (três) dias úteis após envio da respectiva medição do sinal. " +
    "Saldo Contratual: o valor remanescente será medido quinzenalmente, considerando os serviços efetivamente executados no respectivo período. " +
    `Cada medição terá vencimento em ${prazo} contados a partir do último dia do período a que se refere a medição, mediante ${meio}.`;
}
const TEXTO_PAGAMENTO_PADRAO = textoPagamentoPadrao(15, "deposito");


const TEXTO_INSTITUCIONAL =
  'Desde 1997, a CGL FUNDAÇÕES, <b>ESPECIALIZADA EM ESTACA HÉLICE CONTÍNUA MONITORADA, ' +
  'ESTACA SECANTE (PAREDE DIAFRAGMA COM ESTACAS SECANTES), ESTACAS RAIZ, TIRANTES, SOLO ' +
  'GRAMPEADO, PERFURAÇÃO DE POÇOS, ESTACA PRESSOANCORAGEM, ESCAVADAS TRADO MECANIZADO, ' +
  'MARTELO HIDRÁULICO (CRAVAÇÃO ESTACAS METÁLICAS E ESTACAS CONCRETO PRÉ-MOLDADO),</b> ' +
  'vem atender a solicitação de V. Sas. e apresentar nossa <b>proposta</b> para execução ' +
  'dos serviços em referência nas condições abaixo discriminadas.';


const NOTA_INSS =
  '* Conforme inciso VI do artigo 30 da Lei 8.212/91 e em conformidade com o inciso II do parágrafo 3° ' +
  'do artigo 220 do Decreto 3.048/99 e Instrução Normativa nº 2110/2022 ART 130 PARÁGRAFO 1º, não se ' +
  'aplicam às disposições de retenção de 11% para os serviços geotécnicos e de fundações, tais como, ' +
  'obras de contenção e tirantes, sondagens, estacas, sapatas, fundações especiais, etc.';




function dataPorExtensoBR(iso){
  if(!iso) return "";
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                 "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const p = String(iso).slice(0,10).split("-");
  if(p.length !== 3) return iso;
  return `${p[2]} ${meses[Number(p[1])-1]} de ${p[0]}`;
}





const CSS_PROPOSTA = `
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color:#000;
         margin:0; padding:0; line-height:1.35; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 4px 6px; vertical-align: top; border: 1px solid #000; }
  thead th { background: #d9d9d9; text-align: center; font-weight: bold; font-size: 9pt; }
  .cab-tabela th { background: #d9d9d9; }
  .cab-empresa { width:100%; border-collapse: collapse; margin-bottom: 4px; }
  .cab-empresa td { border: 1px solid #000; padding: 4px; }
  .cab-logo { width: 90px; text-align:center; padding:6px; vertical-align: middle; }
  .cab-logo img { display:block; margin:0 auto; max-height: 70px; max-width: 80px; }
  .cab-meio { background: #fff; }
  .cab-meio .sgq { text-align:center; font-size: 8.5pt; padding: 2px; border-bottom: 1px solid #000; }
  .cab-meio .tipo-doc { background: #c0c0c0; padding: 2px 6px; font-size: 8.5pt; }
  .cab-meio .nome-doc { text-align:center; font-weight:bold; font-size: 12pt; padding: 6px; }
  .cab-meta { width: 130px; font-size: 7.5pt; padding:0; }
  .cab-meta table { width:100%; border: none; }
  .cab-meta table td { border: 1px solid #000; padding: 2px 4px; }
  .cab-meta .lbl { background: #f97316; color:#fff; font-weight:bold; font-size: 7pt; }
  .cab-meta .val { text-align:center; }
  .destinatario { margin-top: 10px; }
  .destinatario .cli-nome { font-weight:bold; font-size: 14pt; margin-bottom: 2px; }
  .destinatario .data-cidade { float:right; font-size: 9pt; }
  .destinatario .campos { margin-top: 4px; font-size: 9pt; clear:both; }
  .destinatario .campos div { margin: 1px 0; }
  .numero-proposta { text-align:center; margin: 14px 0 6px; font-weight:bold; font-size: 12pt; color:#c2410c; }
  .numero-proposta .num { font-size: 14pt; }
  .numero-proposta .rev { font-size: 9pt; color:#000; margin-left: 20px; }
  .par-intro { margin: 10px 0; text-align: justify; }
  .par-ref { margin: 6px 0; }
  .par-ref b { font-weight: bold; }
  .secao-titulo { background:#d9d9d9; text-align:center; font-weight:bold; padding:4px;
                  border:1px solid #000; margin-top: 10px; font-size: 9.5pt; }
  .cond-gerais { background:#fff7d6; border:1px solid #000; border-top: none; padding: 6px 10px;
                 text-align: center; font-style: italic; }
  .cond-gerais .escopo { color:#a16207; font-weight:bold; font-style:italic; }
  .quadro-precos { margin-top: 8px; }
  .quadro-precos th { background: #d9d9d9; }
  .quadro-precos .item-secao td { background: #d9d9d9; font-weight: bold; text-align: center; }
  .quadro-precos .col-item { width: 56%; }
  .quadro-precos .col-un   { width: 9%; text-align:center; }
  .quadro-precos .col-qtd  { width: 9%; text-align:center; }
  .quadro-precos .col-vu   { width: 12%; text-align:right; white-space: nowrap; }
  .quadro-precos .col-vt   { width: 14%; text-align:right; white-space: nowrap; }
  .sigla { white-space: nowrap; }   /* lote S42 (L3): NBR-7212, NBR-12.655 não quebram no meio */
  .quadro-precos .total-linha td { font-weight: bold; background: #d9d9d9; }
  .obs-itens { margin-top: 8px; }
  .obs-itens .obs { border:1px solid #000; padding: 4px 6px; font-size: 8.5pt; }
  .obs-itens .obs + .obs { border-top: none; }
  .nota-inss { font-size: 7.5pt; padding: 4px 6px; border:1px solid #000; border-top:none; }
  .encargos { margin-top: 12px; }
  .encargos th.desc-col { width: 64%; text-align:left; padding-left: 8px; }
  .encargos th.x-col   { width: 12%; }
  .encargos .x { text-align:center; font-weight:bold; }
  .encargos .destaque td { background: #fff7d6; }
  .clausulas { margin-top: 12px; }
  .clausulas .item { border:1px solid #000; padding: 4px 6px; font-size: 8.5pt; text-align: justify; }
  .clausulas .item + .item { border-top: none; }
  .clausulas .item.destaque { font-weight: bold; font-style: italic; }
  .bloco-final { margin-top: 14px; text-align: center; }
  .bloco-final .ass-linha { display:inline-block; border-top: 1px solid #000;
                            width: 280px; margin-top: 30px; padding-top: 4px; }
  .bloco-comercial { text-align:center; margin: 8px 0; font-size: 9pt; }
  .bloco-comercial .nome { font-weight: bold; }
  .nf-dados { margin-top: 10px; border:1px solid #000; }
  .nf-dados .titulo { background:#d9d9d9; text-align:center; font-weight:bold; padding: 4px; border-bottom:1px solid #000; }
  .nf-dados .corpo { padding: 8px; font-size: 9pt; line-height: 1.9; }
  .nf-dados .linha-preenchimento { border-bottom: 1px solid #000; display:inline-block; min-width: 60%; }
  .nf-dados .de-acordo { margin-top: 14px; font-size: 11pt; font-weight: bold; }
  .nf-dados .assinatura-info { text-align:center; font-size: 8.5pt; margin-top: 4px; }
  .nf-dados .obs-rodape { font-size: 8pt; padding: 4px 8px; border-top:1px solid #000; }
  .rodape-empresa { text-align:center; font-size: 8pt; padding: 6px; border:1px solid #000; border-top: none; }
  .rodape-empresa b { font-weight: bold; }
  .quebra { page-break-after: always; }
  .nao-quebrar { page-break-inside: avoid; }
`;





function siglasSemQuebra(html){ return   String(html || "").replace(/\bNBR-?\s?[\d.]+/g, m => `<span class="sigla">${esc(m)}</span>`); }



function blocoCabecalho(tipo, codigoModelo, revisao){
  const t = PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro;
  const codigo = codigoModelo || t.codigo;
  const rev    = revisao || t.revisao_padrao;
  return `
    <table class="cab-empresa">
      <tr>
        <td class="cab-logo" rowspan="2">${obterLogoHTML()}</td>
        <td class="cab-meio" colspan="2">
          <div class="sgq">Sistema de Gestão da Qualidade</div>
        </td>
      </tr>
      <tr>
        <td class="cab-meio">
          <div class="tipo-doc">Tipo de Documento</div>
          <div class="nome-doc">PROPOSTA COMERCIAL - ${esc(t.rotulo)}</div>
        </td>
        <td class="cab-meta">
          <table>
            <tr><td class="lbl">Identificação</td></tr>
            <tr><td class="val">${esc(codigo)}</td></tr>
            <tr><td class="lbl">Revisão</td></tr>
            <tr><td class="val">${esc(rev)}</td></tr>
          </table>
        </td>
      </tr>
    </table>`;
}


function blocoDestinatario(cliente, cidadeEmissao, dataOrcamento, orcamento){
  if(!cliente) cliente = {};
  const o = orcamento || {};

  return `
    <div class="destinatario nao-quebrar">
      <div class="data-cidade">${esc(cidadeEmissao || "Itabira/MG")}, ${esc(dataPorExtensoBR(dataOrcamento))}</div>
      <div>À</div>
      <div class="cli-nome">${esc(cliente.nome_fantasia || cliente.nome || "—")}</div>
      <div class="campos">
        <div>Razão Social: ${esc(cliente.nome || "")}</div>
        <div>CNPJ de faturamento: ${esc(cliente.cpf_cnpj || "")}</div>
        <div>E-mail: ${esc(o.contato_email || cliente.email || "")}</div>
        <div>A/c: ${esc(o.contato_nome || cliente.contato_nome || "")}</div>
        <div>Tel.: ${esc(o.contato_telefone || cliente.telefone || "")}</div>
      </div>
    </div>`;
}


function blocoNumeroProposta(numero, dataOrcamento, revisao){
  return `
    <div class="numero-proposta">
      PROPOSTA CONTRATO: <span class="num">${esc(orcNumeroExibicao(numero, dataOrcamento))}</span>
      <span class="rev">REV: ${esc(revisao || "")}</span>
    </div>`;
}


function blocoIntroducao(referenciaObra, tipo){
  const tipoNome = (PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro).rotulo;
  return `
    <div class="par-intro nao-quebrar">
      Proposta contrato para execução de Fundações Especiais por empreitada com emprego de todos
      materiais e apuração através de medições das quantidades por preços unitários, conforme dados
      e condições abaixo:
    </div>
    <div class="par-ref nao-quebrar">
      <b>Ref:</b> Execução de estacas tipo <b>${esc(tipoNome)}</b> ${esc(referenciaObra || "")}
    </div>
    <div class="par-intro nao-quebrar">${TEXTO_INSTITUCIONAL}</div>`;
}






function _propostaRessalva(o){
  const temProj = o.projeto_fornecido === true || o.projeto_sondagem_fornecido === true;
  const temSond = o.sondagem_fornecida === true || o.projeto_sondagem_fornecido === true;
  if(!temProj && !temSond) return "Proposta sujeita a alteração após análise de projeto e sondagem.";
  if(!temProj)             return "Proposta sujeita a alteração após análise do projeto de fundações.";
  if(!temSond)             return "Proposta sujeita a alteração após análise da sondagem.";
  return "";
}
function blocoCondicoesGerais(escopo, equipamento, orcamento){
  const o = orcamento || {};
  const linhas = (escopo || "").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const escopoHTML = linhas.length
    ? linhas.map(l => `<div class="escopo">• ${esc(l)}</div>`).join("")
    : `<div class="escopo">• Escopo a ser preenchido na ficha do orçamento.</div>`;
  const ressalva = _propostaRessalva(o);
  return `
    <div class="nao-quebrar">
    <div class="secao-titulo">CONDIÇÕES GERAIS DA PROPOSTA</div>
    <div class="cond-gerais">
      <div>Baseado nas informações fornecidas por V. Sas., previmos executar as estacas conforme discriminado abaixo:</div>
      ${escopoHTML}
      ${ressalva ? `<div><i>${esc(ressalva)}</i></div>` : ""}
      ${equipamento ? `<div><i>Considerado equipamento ${esc(equipamento)}.</i></div>` : ""}
      ${o.local_execucao ? `<div>Local de execução: <b>${esc(o.local_execucao)}</b></div>` : ""}
      ${o.prazo_execucao ? `<div>Prazo de execução previsto: <b>${esc(o.prazo_execucao)}</b></div>` : ""}
    </div>
    </div>`;
}





function calcularTotaisProposta(itens, orcamento){
  const subtotal = (itens || []).reduce((s, it) => s + Number(it.quantidade || 0) * Number(it.valor_unitario || 0), 0);
  const p  = Number((orcamento && orcamento.iss_percentual) || 0);
  const iss = orcIssSobre(subtotal, orcamento);
  const pTxt = String(p).replace(".", ",").replace(/,0+$/, "");
  const rotulo = iss > 0 ? `ISS ${pTxt}%` : "";
  return { subtotal, iss, total: subtotal + iss, rotulo };
}



function _propostaLinhasQuadro(itens){
  const linhas = [];
  let nivel = 1, secaoAtual = null, secaoNumero = null, subIndex = 0;
  (itens || []).forEach(it => {
    let rotuloNum;
    if(it.secao && it.secao.trim()){
      if(it.secao !== secaoAtual){
        secaoAtual = it.secao; secaoNumero = nivel; subIndex = 0;
        linhas.push({ secao: secaoNumero + "- " + it.secao });
        nivel++;
      }
      subIndex++;
      rotuloNum = secaoNumero + "." + subIndex;
    } else {
      secaoAtual = null;
      rotuloNum = String(nivel);
      nivel++;
    }
    it._num = rotuloNum;
    linhas.push({ it, num: rotuloNum });
  });
  return { linhas, proximo: nivel };
}




function blocoQuadroPrecos(itens, orcamento){
  if(!itens || !itens.length){
    return `
      <div class="secao-titulo" style="margin-top:8px;">Quadro de Preços</div>
      <div class="cond-gerais" style="text-align:center;">Sem itens cadastrados.</div>`;
  }
  const tot = calcularTotaisProposta(itens, orcamento);

  let html = `
    <table class="quadro-precos">
      <thead>
        <tr><th colspan="6">Quadro de Preços: Seguem abaixo os preços unitários para execução dos serviços.</th></tr>
        <tr>
          <th class="col-item">ITEM</th>
          <th class="col-un">Unidade</th>
          <th class="col-qtd">Quant.</th>
          <th class="col-vu">Valor Unit (R$)</th>
          <th colspan="2" class="col-vt">Valor Total (R$)</th>
        </tr>
      </thead>
      <tbody>`;



  const quadro = _propostaLinhasQuadro(itens);
  const nivel = quadro.proximo;

  quadro.linhas.forEach(l => {
    if(l.secao){
      html += `<tr class="item-secao"><td colspan="6">${esc(l.secao)}</td></tr>`;
      return;
    }
    const it = l.it;
    const qtd = Number(it.quantidade || 0);
    const vu  = Number(it.valor_unitario || 0);
    const vt  = qtd * vu;

    html += `
      <tr>
        <td>${esc(l.num)}- ${esc(it.descricao || "")}</td>
        <td class="col-un">${esc(it.unidade || "")}</td>
        <td class="col-qtd">${qtd ? num(qtd) : "–"}</td>
        <td class="col-vu">${brl(vu)}</td>
        <td colspan="2" class="col-vt"${qtd ? "" : ' style="text-align:center;"'}>${qtd ? brl(vt) : "–"}</td>
      </tr>`;
  });

  if(tot.iss > 0){
    html += `
      <tr>
        <td>${esc(nivel)}- ${esc(tot.rotulo)}</td>
        <td class="col-un"></td>
        <td class="col-qtd"></td>
        <td class="col-vu"></td>
        <td colspan="2" class="col-vt">${brl(tot.iss)}</td>
      </tr>`;
  }

  html += `
        <tr class="total-linha">
          <td colspan="4" style="text-align:right;">Valor Total Estimado</td>
          <td colspan="2" class="col-vt">${brl(tot.total)}</td>
        </tr>
      </tbody>
    </table>`;

  return html;
}







function _propostaObservacoes(itens, notasInternas){
  const notas = notasInternas instanceof Set ? notasInternas : new Set();
  return (itens || []).filter(i => i.observacao && i.observacao.trim() && !notas.has(i.observacao.trim())).map(i => {
    const t = i.observacao.trim();
    if(/^obs\b/i.test(t)) return t;
    return i._num ? "Obs: Item " + i._num + " - " + t : "Obs: " + t;
  });
}
function blocoObservacoesItens(itens, notasInternas){
  const obs = _propostaObservacoes(itens, notasInternas);
  if(!obs.length) return "";
  return `
    <div class="obs-itens">
      ${obs.map(t => `<div class="obs nao-quebrar">${esc(t)}</div>`).join("")}
    </div>`;
}


function blocoNotaINSS(){
  return `<div class="nota-inss nao-quebrar">${NOTA_INSS}</div>`;
}





function _propostaCargo(c){
  if(!c) return "Comercial";
  return (typeof CARGOS !== "undefined" && CARGOS[c]) || (String(c).charAt(0).toUpperCase() + String(c).slice(1).replace(/_/g, " "));
}
function _propostaTelefone(t){
  const d = String(t || "").replace(/\D/g, "");
  if(d.length < 10) return String(t || "").trim();
  const resto = d.slice(2), corte = resto.length === 8 ? 4 : 5;
  return `(${d.slice(0, 2)}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}
function blocoComercial(responsavel){
  const r = responsavel || {};
  return `
    <div class="nao-quebrar">
    <div class="bloco-final">
      <div class="ass-linha">${esc(CGL_INFO.razao_social)}</div>
    </div>
    <div class="bloco-comercial">
      <div class="nome">${esc(r.nome || "—")}</div>
      <div>${esc(_propostaCargo(r.cargo))}</div>
      ${r.telefone ? `<div>Cel.: ${esc(_propostaTelefone(r.telefone))}</div>` : ""}
      ${r.email    ? `<div>${esc(r.email)}</div>`         : ""}
      <div>${esc(CGL_INFO.site)}</div>
    </div>
    </div>`;
}


function blocoDeAcordo(){
  return `
    <div class="nf-dados nao-quebrar">
      <div class="corpo">
        <div class="de-acordo">De acordo: Em ___/___/____. <span class="linha-preenchimento" style="min-width:50%;"></span></div>
        <div class="assinatura-info">(Assinatura e Carimbo)</div>
      </div>
      <div class="obs-rodape">
        Obs: Favor enviar junto com o "De acordo" última alteração contratual e caso não seja
        assinado pelo representante legal da empresa enviar procuração.
      </div>
    </div>`;
}


function blocoRodapeEmpresa(){
  return `
    <div class="rodape-empresa nao-quebrar">
      <b>${esc(CGL_INFO.endereco)} &nbsp;&nbsp; FONE: ${esc(CGL_INFO.telefone)}</b><br>
      E-mail: ${esc(CGL_INFO.emails)}<br>
      Site: ${esc(CGL_INFO.site)}
    </div>`;
}









const TXT_RG = {
  mobTransporte: "Fornecimento e Transporte de equipe e equipamentos necessários para Mobilização e Desmobilização. " +
    "(O transporte dos equipamentos e materiais será de responsabilidade da CONTRATADA até o limite em que " +
    "seja tecnicamente e operacionalmente possível o acesso por meio de seus veículos próprios (carros e " +
    "caminhões). Fica expressamente consignado que tais veículos não são mobilizados para circulação ou " +
    "operação em áreas industriais, cabendo à CONTRATANTE, quando aplicável, providenciar os meios necessários " +
    "para o transporte interno, remoção ou acesso complementar aos locais onde os veículos da CONTRATADA não " +
    "consigam alcançar.).",
  epi: "Fornecimento de E.P.I para nossos colaboradores. Caso seja exigido EPI específico da área, será de responsabilidade do contratante.",
  art: "Recolhimento de A.R.T dos serviços executados, conforme regulamentação do CREA.",
  diario: "Elaboração do Diário de Obra.",
  encargosTrab: "Pagamento de todos Encargos trabalhistas e sociais, conforme legislação vigente.",
  locacaoRN: "Locação topográfica e marcação R.N. indicados no projeto de fundações.",
  controleTec: "Controle tecnológico de todos materiais e normas vigentes.",
  atestado: "Fornecimento de Atestado de Conclusão dos serviços.",
  frente: "Fornecimento de frente continua para execução dos serviços.",
  tapumes: "Execução de tapumes para segurança, equipamentos de segurança coletiva (E.P.C) conforme a NR18.",
  vigilancia: "Vigilância e Proteção dos Equipamentos/ ferramentas e utensílios alocados na obra.",
  kitAmbiental: "O fornecimento e a disponibilização de kit(s) de mitigação ambiental, incluindo materiais para contenção de eventuais vazamentos de óleo, combustíveis, graxas ou outros agentes",
  projetos: "Fornecimento de projetos, sondagens, licenças e/ou autorização pública ou particular, necessárias à execução do serviço.",
  seguro: "Seguro Geral inclusive seguro de riscos de Engenharia com adicional de responsabilidade civil geral e cruzada contra terceiros, entregues em tempo Hábil ao início das atividades, bem como execução, proteção e escoramento de construção vizinhas.",
  canteiro: "Canteiro de obra limpo e desimpedido de obstáculos ocultos ou aparentes, nivelado, capacidade de suporte de 2,0kg/cm2, com rampa de acesso para veículos pesados.",
  munck: "Fornecimento de caminhão munck e PTA para realização da montagem, desmontagem, mudanças de frentes e manutenções preventivas e corretivas.",
  botaFora: "Bota fora material proveniente da perfuração das estacas.",

  medidas: "Estacas serão medidas do nível do terreno até a cota inferior da estaca.",
  diarioMedicao: "O Diário de obra será utilizado para Medição.",
  diarioDigital: "O Diário de Obra será enviado em formato digital, e a Contratante disporá do prazo de 2 (dois) dias úteis, contados a partir do recebimento, para análise e eventual manifestação quanto ao seu conteúdo. Caso não haja qualquer contestação dentro desse prazo, o referido documento será considerado aceito e validado pelas partes.",
  assinarRdo: "Analisar e assinar diariamente os Diários de Obra (RDO's) da Contratada.",
  prazoMedicoes: "As medições terão prazo de 4 dias úteis para serem analisadas e aprovadas pela contratante. Após esse período, as mesmas serão consideradas aprovadas e originarão as respectivas notas fiscais/duplicatas.",
  retencao: "A Contratada não aceitará a aplicação de retenção técnica sobre os valores das medições realizadas. Como alternativa à retenção, a Contratada disponibiliza, mediante solicitação, a apresentação de Seguro Garantia, nos termos da legislação vigente.",

  bits: "Na escavação em materiais com spt acima de 35 golpes ou ponta de bits, os preços terão acréscimo de 100%.",
  chuva: "CHUVA: em caso de paralisações das atividades por motivo de chuva intermitente e/ou praça de trabalho saturada, que impossibilite trânsito de equipamentos pesados, será considerado 50% do faturamento mínimo acordado para cobrir despesas da CONTRATADA.",
  atraso: "O atraso no pagamento pela CONTRATANTE, acarretará a mesma, multa de 2,0% (dois por cento) ao mês, mais juros diários de 0,10% (dez centésimos) ao dia, até o pagamento.",
  segundoTurno: "Em caso de ser necessário atividades no segundo turno, será cobrado 25% adicionais sobre os valores dos serviços executados.",
  ajudantesExtras: "Nos casos de eventual demanda da CONTRATANTE por fornecimento de ajudantes-extras para limpeza de terra dos trados, considerar o custo adicional de R$ 10,00/m³ (dez reais por metro cúbico escavado), garantindo-se o mínimo de R$ 420,00 por dia por ajudante-extra disponibilizado pela CONTRATADA.",
  acesso: "A responsabilidade pelas condições de acesso ao local da obra para fins de mobilização e desmobilização dos equipamentos será da CONTRATANTE, incluindo a garantia de rotas adequadas e liberadas para o tráfego. Caberá à CONTRATANTE providenciar, quando necessário, autorizações, sinalizações, bloqueios de vias e comunicação junto aos órgãos públicos competentes. Eventuais custos, penalidades ou multas decorrentes de restrições de acesso, autuações de trânsito ou ausência das devidas liberações serão de responsabilidade da CONTRATANTE.",
  frete30: "Em casos em que a mobilização for de responsabilidade da CGL Fundações, o respectivo valor do frete deverá ser faturado diretamente ao Contratante, a fim de evitar a ocorrência de bitributação. Na hipótese de a mobilização ser de responsabilidade da CGL Fundações e o faturamento do frete ocorrer em nome da própria CGL Fundações, o valor correspondente ao custo do frete será acrescido em 30% (trinta por cento), a título de compensação pelos encargos tributários incidentes sobre a operação.",
  diesel30: "Em casos em que o fornecimento do óleo diesel for de responsabilidade da CGL Fundações, o respectivo valor deverá ser faturado diretamente ao Contratante, a fim de evitar a ocorrência de bitributação. Na hipótese de o fornecimento ser de responsabilidade da CGL Fundações e o faturamento ocorrer em nome da própria CGL Fundações, o valor correspondente ao custo do diesel será acrescido em 30% (trinta por cento), a título de compensação pelos encargos tributários incidentes sobre a operação.",
  folga: "Os nossos funcionários têm direito a um final de semana livre contando a sexta-feira a cada 30 dias.",
  acessoMecanico: "Permitir acesso da CONTRATADA por seus representantes e prepostos, empregados ou pessoa por ela indicada (principalmente mecânico) no local da obra, sob pena de incidência do faturamento mínimo dia do equipamento.",
  dieselVariacao: "Os valores apresentados na presente proposta foram calculados com base nos custos vigentes na data de sua elaboração, especialmente no que se refere ao preço do combustível (diesel), insumo essencial à execução dos serviços. Dessa forma, na hipótese de ocorrência de variações relevantes no preço do diesel, devidamente comprovadas e que impactem diretamente os custos operacionais, os valores contratados poderão ser revistos e ajustados, inclusive após o fechamento da proposta, assinatura do contrato e durante a execução dos serviços.",
  sobraConcreto: "Aproveitamento do concreto eventualmente não utilizado por defeito de nossos equipamentos, sobras e/ou com tempo de aplicação vencido, sem ônus para a Contratada."
};






function encargosHelice(flags){
  const f = flags || {};
  return [
    { d: "Fornecimento e Transporte de equipe e equipamentos necessários para Mobilização e Desmobilização. " +
         "(O transporte dos equipamentos e materiais será de responsabilidade da CONTRATADA até o limite em que " +
         "seja tecnicamente e operacionalmente possível o acesso por meio de seus veículos próprios (carros e " +
         "caminhões). Fica expressamente consignado que tais veículos não são mobilizados para circulação ou " +
         "operação em áreas industriais, cabendo à CONTRATANTE, quando aplicável, providenciar os meios necessários " +
         "para o transporte interno, remoção ou acesso complementar aos locais onde os veículos da CONTRATADA não " +
         "consigam alcançar.).", r: "CGL", destaque: true },
    { d: "Fornecimento de E.P.I para nossos colaboradores. Caso seja exigido EPI específico da área, será de responsabilidade do contratante.", r: "CGL" },
    { d: "Recolhimento de A.R.T dos serviços executados, conforme regulamentação do CREA.", r: "CGL" },
    { d: "Elaboração do Diário de Obra.", r: "CGL" },
    { d: "Pagamento de todos Encargos trabalhistas e sociais, conforme legislação vigente.", r: "CGL" },
    { d: "Fornecer teste de cargas e integridade das estacas.", r: "CONTRATANTE" },
    { d: "Efetuar, com precisão, a locação topográfica das estacas. Realizando pré-furos (embocamentos) com, no mínimo, 40cm de profundidade e diâmetro idêntico ao elemento de fundação a ser executado, conforme previsto em projeto.", r: "CONTRATANTE" },
    { d: "Fornecimento de caminhão munck e PTA para realização da montagem, desmontagem, mudanças de frentes e manutenções preventivas e corretivas.", r: "CONTRATANTE" },
    { d: "Locação topográfica e marcação R.N. indicados no projeto de fundações.", r: "CONTRATANTE" },
    { d: "Controle tecnológico de todos materiais e normas vigentes.", r: "CONTRATANTE" },
    { d: "Bombeamento do concreto.", r: "CONTRATANTE" },
    { d: "Remoção dos materiais provenientes das escavações com equipamento mecanizado Retroescavadeira ou similar.", r: "CONTRATANTE" },
    { d: "Fornecimento de 03 (três) ajudantes para limpeza dos trados e outros serviços de remoções de solo.", r: "CONTRATANTE" },
    { d: "Fornecimento de Atestado de Conclusão dos serviços.", r: "CONTRATANTE" },
    { d: "Fornecimento de frente continua para execução dos serviços.", r: "CONTRATANTE" },
    { d: "Execução de tapumes para segurança, equipamentos de segurança coletiva (E.P.C) conforme a NR18.", r: "CONTRATANTE" },
    { d: "Vigilância e Proteção dos Equipamentos, ferramentas e utensílios alocados na obra.", r: "CONTRATANTE" },
    { d: "Fornecimento água, energia elétrica (ponto trifásico 220 v para atender um motor de 10 cv), iluminação, instalações sanitárias, condições mínimas segurança para nossos colaboradores conforme NR-18.", r: "CONTRATANTE" },
    { d: "Hospedagem (limite de 2 pessoas por quarto) e alimentação externa (café da manhã, almoço e jantar) à obra para colaboradores.", r: f.cgl_fornece_hospedagem ? "CGL" : "CONTRATANTE", destaque: true },


    f.cgl_fornece_alimentacao
      ? { d: "Alimentação dentro do canteiro de obras para colaboradores, por conta da CGL (03 funcionários por HC)", r: "CGL", destaque: true }
      : { d: "Alimentação dentro do canteiro de obras para colaboradores. (03 funcionários por HC)", r: "CONTRATANTE", destaque: true },
    { d: "Fornecimento de combustível para os equipamentos (diesel S10) (100 a 150 Litros por HC)", r: f.cgl_fornece_diesel ? "CGL" : "CONTRATANTE", destaque: true },
    { d: "O fornecimento e a disponibilização de kit(s) de mitigação ambiental, incluindo materiais para contenção de eventuais vazamentos de óleo, combustíveis, graxas ou outros agentes.", r: "CONTRATANTE" },
    { d: "Fornecimento de projetos, sondagens, licenças e/ou autorização pública ou particular, necessárias à execução do serviço.", r: "CONTRATANTE" },
    { d: "Seguro Geral inclusive seguro de riscos de Engenharia com adicional de responsabilidade civil geral e cruzada contra terceiros, entregues em tempo Hábil ao início das atividades, bem como execução, proteção e escoramento de construção vizinhas. Caso o contratante não faça o seguro assume todas as responsabilidades em caso de acidente.", r: "CONTRATANTE" },
    { d: "Canteiro de obra limpo e desimpedido de obstáculos ocultos ou aparentes, nivelado, capacidade de suporte de 2,0kg/cm2, com rampa de acesso para veículos pesados.", r: "CONTRATANTE" },
    { d: "Bota fora material proveniente da perfuração das estacas.", r: "CONTRATANTE" },
    { d: "Fornecimento de concreto bombeado (com fornecimento de bomba em tempo integral para não ocorrer hora parada ou a disposição) fck mínimo 20 Mpa, slump 23 +- 2, agregado máximo brita 0, sem pó de pedra, consumo mínimo de 400 kg de cimento por m3, conforme normas: NBR-5739, NBR-7212 e NBR-12.655. Volume de concreto previsto.", r: "CONTRATANTE" },
    { d: "Carreta prancha e caminhão munck para desmontagem interna à obra e deslocamento.", r: "CONTRATANTE" },
    { d: "Aço conforme projeto cortado, montado e dobrado, armado em \"gaiolas\" prevendo equipamento de apoio para lançamento caso seja necessário.", r: "CONTRATANTE" },
    { d: "Armadura de comprimento longitudinal maior que 6,0m deverá ser fornecido concreto especial, Traço com aditivo especial para auxiliar na penetração da mesma no fuste concretado.", r: "CONTRATANTE" }
  ];
}



const CLAUSULA_LIMPEZA_DESDE = "2026-11-19";
function _clausulaRefuro(orcamento){
  const criado = orcamento && orcamento.created_at ? String(orcamento.created_at).slice(0, 10) : null;
  if(criado && criado < CLAUSULA_LIMPEZA_DESDE){
    return "Nos casos em que for preciso refurar estacas, por qualquer motivo alheio à CGL (exemplos: dificuldade na inserção da armação, concreto insuficiente para finalização da estaca, concreto fora da especificação causando entupimentos, etc.), será cobrado o metro linear do refuro no mesmo valor praticado para o furo.";
  }
  return "Nos casos em que for preciso refurar ou fazer a limpeza de estacas, por qualquer motivo alheio à CGL (exemplos: dificuldade na inserção da armação, concreto insuficiente para finalização da estaca, concreto fora da especificação causando entupimentos, etc.), será cobrado o metro linear do refuro ou da limpeza no mesmo valor praticado para o furo.";
}


function criteriosMedicaoHelice(orcamento){

  const pagamento = (orcamento && orcamento.condicoes_pagamento && orcamento.condicoes_pagamento.trim())
    || textoPagamentoPadrao(orcamento && orcamento.prazo_pagamento_dias, orcamento && orcamento.pagamento_forma);
  return [
    { t: "Estacas serão medidas do nível do terreno até a cota inferior da estaca." },
    { t: "O Diário de obra será utilizado para Medição." },
    { t: "O Diário de Obra será enviado em formato digital, e a Contratante disporá do prazo de 2 (dois) dias úteis, contados a partir do recebimento, para análise e eventual manifestação quanto ao seu conteúdo. Caso não haja qualquer contestação dentro desse prazo, o referido documento será considerado aceito e validado pelas partes." },
    { t: "Analisar e assinar diariamente os Diários de Obra (RDO's) da Contratada." },
    { t: "As medições terão prazo de 4 dias úteis para serem analisadas e aprovadas pela contratante. Após esse período, as mesmas serão consideradas aprovadas e originarão as respectivas notas fiscais/duplicatas." },

    { t: TXT_RG.bits },
    { t: "A Contratada não aceitará a aplicação de retenção técnica sobre os valores das medições realizadas. Como alternativa à retenção, a Contratada disponibiliza, mediante solicitação, a apresentação de Seguro Garantia." },
    { t: "No caso da inserção das armaduras se darem com o uso de nossos equipamentos cobraremos de preço de R$ 0,75 por kg levantado." },
    { t: "CHUVA: em caso de paralisações das atividades por motivo de chuva intermitente e/ou praça de trabalho saturada, que impossibilite trânsito de equipamentos pesados, será considerado 50% do faturamento mínimo acordado para cobrir despesas da CONTRATADA." },
    { t: "Os preços se referem aos serviços prestados em jornada de trabalho no horário normal segunda à sexta-feira de 07:00 as 17:00hs. Caso seja feito horas extras o valor será de R$ 380,00 por hora (equipe)." },
    { t: pagamento, destaque: true },
    { t: "O atraso no pagamento pela CONTRATANTE, acarretará a mesma, multa de 2,0% (dois por cento) ao mês, mais juros diários de 0,10% (dez centésimos) ao dia, até o pagamento." },
    { t: "Em caso de ser necessário atividades no segundo turno, será cobrado 25% adicionais sobre os valores dos serviços executados.", destaque: true },
    { t: "Nos casos de eventual demanda da CONTRATANTE por fornecimento de ajudantes-extras para limpeza de terra dos trados, considerar o custo adicional de R$ 10,00/m³ (dez reais por metro cúbico escavado), garantindo-se o mínimo de R$ 420,00 por dia por ajudante-extra disponibilizado pela CONTRATADA." },
    { t: _clausulaRefuro(orcamento) },
    { t: "A responsabilidade pelas condições de acesso ao local da obra para fins de mobilização e desmobilização dos equipamentos será da CONTRATANTE, incluindo a garantia de rotas adequadas e liberadas para o tráfego. Caberá à CONTRATANTE providenciar, quando necessário, autorizações, sinalizações, bloqueios de vias e comunicação junto aos órgãos públicos competentes. Eventuais custos, penalidades ou multas decorrentes de restrições de acesso, autuações de trânsito ou ausência das devidas liberações serão de responsabilidade da CONTRATANTE." },
    { t: "Em casos em que a mobilização for de responsabilidade da CGL Fundações, o respectivo valor do frete deverá ser faturado diretamente ao Contratante, a fim de evitar a ocorrência de bitributação. Na hipótese de a mobilização ser de responsabilidade da CGL Fundações e o faturamento do frete ocorrer em nome da própria CGL Fundações, o valor correspondente ao custo do frete será acrescido em 30% (trinta por cento), a título de compensação pelos encargos tributários incidentes sobre a operação." },
    { t: "Em casos em que o fornecimento do óleo diesel for de responsabilidade da CGL Fundações, o respectivo valor deverá ser faturado diretamente ao Contratante, a fim de evitar a ocorrência de bitributação. Na hipótese de o fornecimento ser de responsabilidade da CGL Fundações e o faturamento ocorrer em nome da própria CGL Fundações, o valor correspondente ao custo do diesel será acrescido em 30% (trinta por cento), a título de compensação pelos encargos tributários incidentes sobre a operação." },
    { t: "Nos casos em que for solicitada a execução de pré-furos/furos secos pelo equipamento, considerar o preço do metro linear escavado igual a 80% do valor do metro linear de hélice contínua monitorada acordado para o diâmetro correspondente. Nesses casos, além do furo seco, a estaca hélice continua monitorada será cobrada em sua integralidade, desde a cota de apoio do equipamento até a cota de fundo da estaca." },
    { t: "Caberá à CONTRATANTE ressarcir a CONTRATADA os prejuízos com danos e/ou perdas de ferramentas de perfuração (trado, ponteira, etc.) em razão de obstáculos e/ou alteração no subsolo não prevista pela sondagem (pedras, matacões, rocha sã, estruturas de concreto, etc.). Ao final dos serviços, se houver danos e/ou perdas, devem ser apresentadas à CONTRATANTE pela CONTRATADA." },
    { t: "Os nossos funcionários têm direito a um final de semana livre contando a sexta-feira a cada 30 dias." },
    { t: "Os valores apresentados na presente proposta foram calculados com base nos custos vigentes na data de sua elaboração, especialmente no que se refere ao preço do combustível (diesel), insumo essencial à execução dos serviços. Dessa forma, na hipótese de ocorrência de variações relevantes no preço do diesel, devidamente comprovadas e que impactem diretamente os custos operacionais, os valores contratados poderão ser revistos e ajustados, inclusive após o fechamento da proposta, assinatura do contrato e durante a execução dos serviços." },
    { t: "Caso o equipamento de perfuração esteja efetivamente disponível e designado à apoio na inserção das armações o referido serviço passará a integrar o escopo de atividades diárias do equipamento, sendo, portanto, considerado para fins de apuração do faturamento mínimo diário conforme quadro de preços." },
    { t: "Permitir acesso da CONTRATADA por seus representantes e prepostos, empregados ou pessoa por ela indicada (principalmente mecânico) no local da obra, sob pena de incidência do faturamento mínimo dia do equipamento." },
    { t: "Aproveitamento do concreto eventualmente não utilizado por defeito de nossos equipamentos, sobras e/ou com tempo de aplicação vencido, sem ônus para a Contratada." }
  ];
}


function condicoesGeraisHelice(){
  return [
    { t: "Caso houver necessidade de mudanças internas entre as frentes de serviços, ou a necessidade de desmontar a perfuratriz, será cobrada o período efetivamente paralisado até o reinicio dos serviços no valor de hora parada / Fat. Mínimo dia e ou Locação Diária." },
    { t: "Tendo em vista que a prestação dos serviços ocorre de forma intermitente e em diversas cidades e estados, fica estabelecido que será observada, exclusivamente, a Convenção Coletiva de Trabalho vinculada à sede da matriz da CONTRATADA, não sendo possível a aplicação ou vinculação a quaisquer outras convenções coletivas de outras localidades. Se mesmo assim a CONTRATADA for obrigada a cumprir obrigações de outras convenções, para manter o equilíbrio financeiro do contrato, esse custo será integralmente repassado à CONTRATANTE." }
  ];
}









function _clausulaPagamento(orcamento){
  return (orcamento && orcamento.condicoes_pagamento && orcamento.condicoes_pagamento.trim())
    || textoPagamentoPadrao(orcamento && orcamento.prazo_pagamento_dias, orcamento && orcamento.pagamento_forma);
}

function encargosTrado(flags){
  const f = flags || {};
  return [
    { d: TXT_RG.mobTransporte, r: "CGL", destaque: true },
    { d: TXT_RG.epi, r: "CGL" },
    { d: TXT_RG.art, r: "CGL" },
    { d: TXT_RG.diario, r: "CGL" },
    { d: TXT_RG.encargosTrab, r: "CGL" },
    { d: "Efetuar, com precisão, a locação topográfica das estacas. Realizando pré-furos (embocamentos) com, no mínimo, 40cm de profundidade e diâmetro idêntico ao elemento de fundação a ser executado, conforme previsto em projeto. Não está autorizado execução das estacas SEM o embocamento.", r: "CONTRATANTE" },
    { d: TXT_RG.controleTec, r: "CONTRATANTE" },
    { d: "Fornecimento de concreto, bem como montagem e lançamento do aço conforme projeto.", r: "CONTRATANTE" },
    { d: "Bombeamento do concreto.", r: "CONTRATANTE" },
    { d: "Remoção dos materiais provenientes das escavações com equipamento mecanizado Retro escavadeira.", r: "CONTRATANTE" },
    { d: TXT_RG.atestado, r: "CONTRATANTE" },
    { d: TXT_RG.frente, r: "CONTRATANTE" },
    { d: TXT_RG.tapumes, r: "CONTRATANTE" },
    { d: TXT_RG.vigilancia, r: "CONTRATANTE" },
    { d: "Fornecimento água, energia elétrica, instalações sanitárias conforme NR18.", r: "CONTRATANTE" },
    { d: "Hospedagem, alimentação EXTERNA À OBRA para colaboradores.", r: f.cgl_fornece_hospedagem ? "CGL" : "CONTRATANTE", destaque: true },
    f.cgl_fornece_alimentacao
      ? { d: "Alimentação para colaboradores dentro do canteiro de obra, por conta da CGL", r: "CGL", destaque: true }
      : { d: "Alimentação para colaboradores dentro do canteiro de obra", r: "CONTRATANTE", destaque: true },
    { d: "Fornecimento de Combustível (S10) para os Equipamentos (Media de 80 litros diários)", r: f.cgl_fornece_diesel ? "CGL" : "CONTRATANTE", destaque: true },
    { d: TXT_RG.kitAmbiental, r: "CONTRATANTE" },
    { d: TXT_RG.projetos, r: "CONTRATANTE" },
    { d: TXT_RG.seguro, r: "CONTRATANTE" },
    { d: TXT_RG.canteiro, r: "CONTRATANTE" },
    { d: TXT_RG.munck, r: "CONTRATANTE" },
    { d: TXT_RG.botaFora, r: "CONTRATANTE" }
  ];
}

function criteriosMedicaoTrado(orcamento){
  return [
    { t: TXT_RG.medidas },
    { t: TXT_RG.diarioMedicao },
    { t: TXT_RG.diarioDigital },
    { t: TXT_RG.assinarRdo },
    { t: TXT_RG.retencao },
    { t: "Os preços se referem aos serviços prestados em jornada de trabalho no horário normal segunda à quinta-feira 07:00 as 17:00 e às sextas-feiras, das 7:00 as 16:00 horas. Caso seja feito horas extras o valor será de R$ 380,00 por hora (Equipe)." },
    { t: TXT_RG.bits },
    { t: TXT_RG.chuva },
    { t: TXT_RG.atraso },
    { t: TXT_RG.prazoMedicoes },
    { t: TXT_RG.acesso },
    { t: TXT_RG.frete30 },
    { t: TXT_RG.diesel30 },
    { t: TXT_RG.folga },
    { t: _clausulaPagamento(orcamento), destaque: true },
    { t: TXT_RG.segundoTurno, destaque: true },
    { t: TXT_RG.acessoMecanico },
    { t: TXT_RG.dieselVariacao },
    { t: "Caso a prestação de serviço do(s) equipamento(s) objeto desta proposta seja mensal, ela será por um período mínimo de 30 (trinta) dias. Caso o período de utilização ultrapasse os 30 dias inicialmente contratados, será cobrado, de forma proporcional, o valor correspondente aos dias excedentes, com base no valor mensal." },
    { t: "Nos casos de locação de equipamento, a contratada terá direito a 40 horas para realização de manutenções preventivas/corretivas sem ônus para contratada. Caso ultrapasse esses dois dias, tais dias serão descontados proporcionalmente no valor mensal." },
    { t: TXT_RG.sobraConcreto }
  ];
}


function condicoesGeraisTrado(){ return condicoesGeraisHelice(); }

function encargosRaiz(flags){
  const f = flags || {};
  return [
    { d: TXT_RG.mobTransporte, r: "CGL", destaque: true },
    { d: TXT_RG.epi, r: "CGL" },
    { d: TXT_RG.art, r: "CGL" },
    { d: TXT_RG.diario, r: "CGL" },
    { d: TXT_RG.encargosTrab, r: "CGL" },
    { d: TXT_RG.locacaoRN, r: "CONTRATANTE" },
    { d: TXT_RG.controleTec, r: "CONTRATANTE" },
    { d: "Fornecimento dos materiais de consumo das estacas (cimento, aditivo e areia lavada), Colocados ao lado da Bomba de injeção.", r: "CONTRATANTE" },
    { d: "Remoção dos materiais provenientes das escavações (lama) com equipamento mecanizado Retro escavadeira e ou similar.", r: "CONTRATANTE" },
    { d: "Fornecimento de 04 (Quatro) ajudantes para limpeza e outros serviços de remoções de solo.", r: "CONTRATANTE" },
    { d: TXT_RG.atestado, r: "CONTRATANTE" },
    { d: TXT_RG.frente, r: "CONTRATANTE" },
    { d: TXT_RG.tapumes, r: "CONTRATANTE" },
    { d: TXT_RG.vigilancia, r: "CONTRATANTE" },
    { d: "Fornecimento de água para as perfurações e injeções das estacas em pontos distantes até 10 metros dos locais de utilização, prevendo-se um consumo médio de 30m3/dia por equipamento.", r: "CONTRATANTE" },
    { d: "Fornecimento de energia elétrica trifásica 220/380V em pontos distantes até 10 metros dos locais de utilização com potência de 130KVA INCLUSIVE LIGAÇÃO E TESTE DOS EQUIPAMENTOS PARA TRABALHO por equipamento de estaca raiz. As instalações sanitárias conforme NR18, será realizada pelo Contratante.", r: "CONTRATANTE" },
    { d: "Execução de canaletas e poços de decantação para receberem a lama das perfurações das estacas.", r: "CONTRATANTE" },
    { d: "Fornecimento de ar comprimido para conclusão da estaca quando solicitado em projeto e para perfuração em rocha, por equipamento. Modelo: 1000pcm - 25kg/cm2 - Vazão mínima aberta 17 Bar.", r: "CONTRATANTE" },
    { d: "Fornecimento de aditivo para perfuração tipo GEO-PLUS E OU BETONITA.", r: "CONTRATANTE" },
    { d: "Hospedagem (limite de 2 pessoas por quarto) e alimentação externa (café da manhã, almoço e jantar) à obra para colaboradores.", r: f.cgl_fornece_hospedagem ? "CGL" : "CONTRATANTE", destaque: true },
    f.cgl_fornece_alimentacao
      ? { d: "Alimentação dentro do canteiro de obras para colaboradores da CONTRATADA, por conta da CGL (equipe de 04 funcionários)", r: "CGL", destaque: true }
      : { d: "Alimentação dentro do canteiro de obras para colaboradores da CONTRATADA. (equipe de 04 funcionários)", r: "CONTRATANTE", destaque: true },
    { d: "Fornecimento de Combustível para os Equipamentos (Previsto de 100 a 150 Litros diários)", r: f.cgl_fornece_diesel ? "CGL" : "CONTRATANTE", destaque: true },
    { d: TXT_RG.kitAmbiental, r: "CONTRATANTE" },
    { d: TXT_RG.projetos, r: "CONTRATANTE" },
    { d: TXT_RG.seguro, r: "CONTRATANTE" },
    { d: "Carreta prancha e caminhão munck para deslocamento entre as frentes de serviço", r: "CONTRATANTE" },
    { d: TXT_RG.munck, r: "CONTRATANTE" },
    { d: "Fornecimento de armadura e/ou tubo perdido. Caso haja concretagem do tubo/estaca, o valor do tubo \"perdido\" será ressarcido à CONTRATADA nas medições.", r: "CONTRATANTE" },
    { d: TXT_RG.canteiro, r: "CONTRATANTE" },
    { d: TXT_RG.botaFora, r: "CONTRATANTE" }
  ];
}


function criteriosMedicaoRaiz(orcamento){
  return [
    { t: TXT_RG.medidas },
    { t: TXT_RG.diarioMedicao },
    { t: TXT_RG.diarioDigital },
    { t: TXT_RG.assinarRdo },
    { t: TXT_RG.prazoMedicoes },
    { t: TXT_RG.retencao },
    { t: "No caso da inserção das armaduras se darem com o uso de nossos equipamentos cobraremos de preço de R$ 0,75 por kg levantado." },
    { t: TXT_RG.chuva },
    { t: "Os preços se referem aos serviços prestados em jornada de trabalho no horário normal segunda à sexta-feira de 07:00 as 17:00. Caso seja feito horas extras o valor será de R$ 380,00 por hora (equipe)." },
    { t: _clausulaPagamento(orcamento), destaque: true },
    { t: TXT_RG.atraso },
    { t: TXT_RG.segundoTurno, destaque: true },
    { t: TXT_RG.ajudantesExtras },
    { t: TXT_RG.acesso },
    { t: TXT_RG.frete30 },
    { t: TXT_RG.diesel30 },
    { t: "Caberá à CONTRATANTE ressarcir a CONTRATADA os prejuízos com danos e/ou perdas de ferramentas de perfuração (revestimentos, triconé, martelo, bits, hastes, etc.) em razão de obstáculos e/ou alteração no subsolo não prevista pela sondagem (pedras, matacões, rocha sã, estruturas de concreto, etc.). Desde que comprovada culpa exclusiva da CONTRATANTE. Ao final dos serviços, se houver danos e/ou perdas, devem ser apresentadas à CONTRATANTE pela CONTRATADA." },
    { t: TXT_RG.folga },
    { t: TXT_RG.acessoMecanico },
    { t: "Caso as atividades de perfuração sejam realizadas em locais com presença de lâmina d'água, a Contratante se obriga a fornecer, previamente, a camisa de revestimento a ser perdida, bem como balsa ou plataforma flutuante devidamente dimensionada e compatível com as cargas e operações do equipamento, de forma a assegurar as condições de segurança e acessibilidade necessárias à adequada execução dos trabalhos." },
    { t: "O item referente ao faturamento mínimo diário do equipamento considera como base a produtividade de perfuração efetiva do referido equipamento Raiz. Em caso de alteração no escopo que implique no aumento do comprimento útil da estaca em mais de 2 (dois) metros ou na modificação do quantitativo inicialmente previsto, será aplicado um acréscimo de 50% (cinquenta por cento) sobre o valor unitário originalmente contratado." },
    { t: TXT_RG.dieselVariacao },
    { t: "Caso seja constatada, durante a execução das atividades, a necessidade de trepanagem do fuste, a definição da metodologia executiva, bem como dos respectivos custos e prazos envolvidos, deverá ser previamente discutida e acordada entre as partes, mediante formalização específica, para prosseguimento dos serviços." },
    { t: "Caso o equipamento de perfuração esteja efetivamente disponível e designado à apoio na injeção de argamassa, inserção das armações o referido serviço passará a integrar o escopo de atividades diárias do equipamento, sendo, portanto, considerado para fins de apuração do faturamento mínimo diário conforme quadro de preços." },
    { t: "Caso a execução das perfurações seja realizada com utilização de água e o CONTRATANTE opte, por qualquer motivo, pelo reaproveitamento da água utilizada, o fornecimento, instalação, operação, manutenção e retirada da bomba de lama/retorno e demais equipamentos necessários para tal finalidade serão de responsabilidade exclusiva do CONTRATANTE, não estando tais itens incluídos no escopo contratual da CONTRATADA. Alternativamente, caso o CONTRATANTE solicite que o fornecimento da bomba de lama/retorno seja realizado pela CGL FUNDAÇÕES, será devida uma verba mensal no valor de R$ 2.500,00 (dois mil e quinhentos reais) por equipamento, valor este que será faturado mensalmente enquanto perdurar a sua utilização na obra, independentemente do regime de produção." },
    { t: TXT_RG.sobraConcreto }
  ];
}


function condicoesGeraisRaiz(){ return condicoesGeraisHelice(); }

function encargosSecante(flags){
  const f = flags || {};
  return [
    { d: TXT_RG.mobTransporte, r: "CGL", destaque: true },
    { d: TXT_RG.epi, r: "CGL" },
    { d: TXT_RG.art, r: "CGL" },
    { d: TXT_RG.diario, r: "CGL" },
    { d: TXT_RG.encargosTrab, r: "CGL" },
    { d: "Efetuar, com precisão, a locação topográfica das estacas, realizando pré-furos (embocamentos) com, no mínimo, 40cm de profundidade e diâmetro idêntico ao elemento de fundação a ser executado, conforme previsto em projeto.", r: "CONTRATANTE" },
    { d: TXT_RG.locacaoRN, r: "CONTRATANTE" },
    { d: TXT_RG.controleTec, r: "CONTRATANTE" },
    { d: "Bombeamento do concreto.", r: "CONTRATANTE" },
    { d: "Fornecimento de 03 (três) ajudantes para limpeza dos trados e outros serviços de remoções de solo.", r: "CONTRATANTE" },
    { d: "Remoção dos materiais provenientes das escavações com equipamento mecanizado Retro escavadeira ou similar.", r: "CONTRATANTE" },
    { d: TXT_RG.atestado, r: "CONTRATANTE" },
    { d: TXT_RG.frente, r: "CONTRATANTE" },
    { d: TXT_RG.tapumes, r: "CONTRATANTE" },
    { d: TXT_RG.vigilancia, r: "CONTRATANTE" },
    { d: "Fornecimento água, energia elétrica (ponto trifásico 220 v para atender um motor de 10 cv), iluminação, instalações sanitárias, condições mínimas segurança para nossos colaboradores conforme NR-18.", r: "CONTRATANTE" },
    { d: "Hospedagem (limite de 2 pessoas por quarto) e alimentação externa (café da manhã, almoço e jantar) à obra para colaboradores.", r: f.cgl_fornece_hospedagem ? "CGL" : "CONTRATANTE", destaque: true },
    f.cgl_fornece_alimentacao
      ? { d: "Alimentação dentro do canteiro de obras para colaboradores, por conta da CGL (03 funcionários por HC)", r: "CGL", destaque: true }
      : { d: "Alimentação dentro do canteiro de obras para colaboradores. (03 funcionários por HC)", r: "CONTRATANTE", destaque: true },
    { d: "Fornecimento de combustível para os equipamentos (diesel S10) (100 a 150 Litros por HC)", r: f.cgl_fornece_diesel ? "CGL" : "CONTRATANTE", destaque: true },
    { d: TXT_RG.kitAmbiental, r: "CONTRATANTE" },
    { d: TXT_RG.projetos, r: "CONTRATANTE" },
    { d: TXT_RG.seguro + " Caso o contratante não faça o seguro assume todas as responsabilidades em caso de acidente.", r: "CONTRATANTE" },
    { d: TXT_RG.canteiro, r: "CONTRATANTE" },
    { d: TXT_RG.botaFora, r: "CONTRATANTE" },
    { d: "Fornecimento de concreto bombeado e ou Argamassa (com fornecimento de bomba em tempo integral para não ocorrer hora parada ou à disposição).", r: "CONTRATANTE" },
    { d: "Aço conforme projeto cortado, montado e dobrado, armado em \"gaiolas\" prevendo equipamento de apoio para lançamento caso seja necessário ou Perfil metálico conforme projeto soldado (ou seja no comprimento de projeto) e em perfeito alinhamento para não comprometer o seu lançamento. Armadura de comprimento longitudinal maior que 6,0m deverá ser fornecido concreto especial, Traço com aditivo especial para auxiliar na penetração da mesma no fuste concretado.", r: "CONTRATANTE" },
    { d: "Locação das estacas (escavação de vala com aproximadamente 30 cm de profundidade e 120 cm de largura, instalação das fôrmas de isopor e preenchimento do entorno com concreto).", r: "CONTRATANTE" },
    { d: "Preparo e limpeza do terreno antes e após a execução dos serviços;", r: "CONTRATANTE" },
    { d: "Fornecimento de caminhão munck e PTA para realização da montagem, desmontagem e mudanças de frentes e manutenções preventivas e corretivas.", r: "CONTRATANTE" },
    { d: "Permissão para entrada e saída dos nossos operários e veículos, no local da obra, mesmo em horário extraordinário, se necessário;", r: "CONTRATANTE" },
    { d: "Providenciar a retirada e recolocação que se fizerem necessárias, de quaisquer obstáculos que porventura prejudiquem a execução dos serviços a nosso cargo;", r: "CONTRATANTE" }
  ];
}



function criteriosMedicaoSecante(orcamento){
  return [
    { t: TXT_RG.medidas },
    { t: TXT_RG.diarioMedicao },
    { t: TXT_RG.diarioDigital },
    { t: TXT_RG.prazoMedicoes },
    { t: TXT_RG.retencao },
    { t: "Em caso de não inserção do perfil/armadura, seja necessário executar um refuro na estaca a mesma será cobrada como uma nova estaca." },
    { t: "CHUVA: em caso de paralisações das atividades por motivo de chuva intermitente e/ou praça de trabalho saturada, que impossibilite trânsito de equipamentos pesados, será considerado 50% do faturamento mínimo acordado." },
    { t: "Os preços se referem aos serviços prestados em jornada de trabalho no horário normal segunda à quinta-feira 07:00 as 17:00 e às sextas-feiras, das 7:00 as 16:00 horas. Caso seja feito horas extras o valor será de R$ 380,00 por hora (Equipe)." },
    { t: TXT_RG.prazoMedicoes + " Será emitida Nota Fiscal de Serviço." },
    { t: _clausulaPagamento(orcamento), destaque: true },
    { t: TXT_RG.atraso },
    { t: TXT_RG.sobraConcreto },
    { t: TXT_RG.segundoTurno, destaque: true },
    { t: TXT_RG.bits },
    { t: TXT_RG.folga },
    { t: TXT_RG.ajudantesExtras },
    { t: TXT_RG.acesso },
    { t: TXT_RG.frete30 },
    { t: TXT_RG.diesel30 },
    { t: _clausulaRefuro(orcamento) },
    { t: "Nos casos em que for solicitada a execução de pré-furos/furos secos pelo equipamento, considerar o preço do metro linear escavado igual a 80% do valor do metro linear de hélice contínua monitorada acordado para o diâmetro correspondente. Nesses casos, além do furo seco, a estaca hélice continua monitorada será cobrada em sua integralidade, desde a cota de apoio do equipamento até a cota de fundo da estaca." },
    { t: TXT_RG.dieselVariacao },
    { t: "Caberá à CONTRATANTE ressarcir a CONTRATADA os prejuízos com danos e/ou perdas de ferramentas de perfuração (trado, ponteira, etc.) em razão de obstáculos e/ou alteração no subsolo não prevista pela sondagem (pedras, matacões, rocha sã, estruturas de concreto, etc.). Ao final dos serviços, se houver danos e/ou perdas, devem ser apresentadas à CONTRATANTE pela CONTRATADA." },
    { t: "Adicional de 1,5% sobre o valor total da obra para fins de seguros." }
  ];
}


function condicoesGeraisSecante(){ return condicoesGeraisHelice(); }


function contratacaoServicosTextoComum(){
  return [
    { t: "Em caso de aceitação da proposta, por estarem justas e assim contratadas, as partes firmam o presente instrumento em 2 (duas) vias de igual teor e forma, perante duas testemunhas, para que produza seus efeitos, valendo a mesma para fazer parte integrante ao contrato definitivo para todos os fins de direito, devendo ainda ser encaminhada uma Ordem de Compra de Serviço e os dados cadastrais a seguir requeridos." }
  ];
}


function validadeTextoComum(dias){
  const d = dias || 30;
  return [
    { t: `A presente proposta tem validade de ${d} (${d === 30 ? "trinta" : d}) dias, contados a partir da data de sua apresentação. Ressalta-se que, para o agendamento do início da obra, deverá ser previamente verificada a disponibilidade dos equipamentos necessários, sendo esta condicionada à confirmação no momento da contratação.` },
    { t: "Em caso de aceitação da presente proposta, solicitamos nos seja encaminhada correspondência, datada e assinada, com o seu \"DE ACORDO\", assim como nos sejam informados o número do CNPJ, o número da Inscrição Estadual e o local para cobrança." },
    { t: "Após assinatura da proposta, será providenciado o contrato." },
    { t: "Colocamo-nos ao seu inteiro dispor para quaisquer esclarecimentos adicionais." }
  ];
}



function encargosPorTipo(tipo, flags){
  switch(tipo){
    case "helice":  return encargosHelice(flags);
    case "trado":   return encargosTrado(flags);
    case "raiz":    return encargosRaiz(flags);
    case "secante": return encargosSecante(flags);
    default:        return [];
  }
}
function criteriosMedicaoPorTipo(tipo, orcamento){
  switch(tipo){
    case "helice":  return criteriosMedicaoHelice(orcamento);
    case "trado":   return criteriosMedicaoTrado(orcamento);
    case "raiz":    return criteriosMedicaoRaiz(orcamento);
    case "secante": return criteriosMedicaoSecante(orcamento);
    default:        return [];
  }
}
function condicoesGeraisPorTipo(tipo){
  switch(tipo){
    case "helice":  return condicoesGeraisHelice();
    case "trado":   return condicoesGeraisTrado();
    case "raiz":    return condicoesGeraisRaiz();
    case "secante": return condicoesGeraisSecante();
    default:        return [];
  }
}





















const PROPOSTA_SEGMENTOS_MODELO = ["helice", "trado", "raiz", "secante"];
const PROPOSTA_MODELO_FLAGS = { diesel: "cgl_fornece_diesel", hospedagem: "cgl_fornece_hospedagem", alimentacao: "cgl_fornece_alimentacao" };
const PROPOSTA_MODELO_RESP = { cgl: "CGL", contratante: "CONTRATANTE", "nao aplica": "NAO" };
const PROPOSTA_MODELO_CAMPOS = ["pagamento", "clausula_refuro", "validade_dias", "validade_extenso"];
const _pmNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();


function propostaModeloLer(texto){
  const r = { encargos: null, clausulas: [], erros: [] };
  let atual = null;
  const erro = (linha, msg) => r.erros.push({ linha, msg });
  String(texto || "").split(/\r?\n/).forEach((bruta, i) => {
    const nl = i + 1;
    const linha = bruta.trim();
    if(!linha) return;
    for(const m of linha.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)){
      if(!PROPOSTA_MODELO_CAMPOS.includes(m[1])) erro(nl, `campo desconhecido {{${m[1]}}} (use ${PROPOSTA_MODELO_CAMPOS.map(c => "{{" + c + "}}").join(", ")})`);
    }
    if(linha.startsWith("##")){
      const cab = linha.replace(/^#+\s*/, "");
      const mc = /^cl[aá]usulas\s*:\s*(.+)$/i.exec(cab);
      if(_pmNorm(cab) === "encargos"){
        if(r.encargos) erro(nl, "a seção Encargos aparece duas vezes");
        r.encargos = r.encargos || []; atual = "encargos";
      } else if(mc){
        atual = { titulo: mc[1].trim(), itens: [] }; r.clausulas.push(atual);
      } else erro(nl, 'cabeçalho desconhecido: use "## Encargos" ou "## Cláusulas: TÍTULO"');
      return;
    }
    if(!atual){ erro(nl, "texto antes do primeiro cabeçalho (## Encargos ou ## Cláusulas: TÍTULO)"); return; }
    const mt = /^\[([^\]]*)\]\s*(.*)$/.exec(linha);
    const fichas = mt ? mt[1].split(";").map(_pmNorm).filter(Boolean) : [];
    const corpo = mt ? mt[2].trim() : linha;
    if(!corpo){ erro(nl, "item sem texto"); return; }
    if(atual !== "encargos"){
      const ruins = fichas.filter(f => f !== "destaque");
      if(ruins.length) erro(nl, `marcação de cláusula desconhecida: [${ruins.join("; ")}] (só [destaque])`);
      atual.itens.push({ t: corpo, destaque: fichas.includes("destaque") });
      return;
    }
    if(!mt){ erro(nl, "encargo sem responsável: comece com [CGL], [CONTRATANTE] ou [NÃO APLICA]"); return; }
    const it = { d: corpo, destaque: false, resp: null, so: null };
    for(const f of fichas){
      let m;
      if(f === "destaque") it.destaque = true;
      else if(PROPOSTA_MODELO_RESP[f]){ if(it.resp) erro(nl, "mais de um responsável"); it.resp = { fixo: PROPOSTA_MODELO_RESP[f] }; }
      else if((m = /^cgl se (.+)$/.exec(f))){
        if(!PROPOSTA_MODELO_FLAGS[m[1]]){ erro(nl, `flag desconhecido "${m[1]}" (diesel, hospedagem ou alimentação)`); continue; }
        if(it.resp) erro(nl, "mais de um responsável");
        it.resp = { flag: PROPOSTA_MODELO_FLAGS[m[1]] };
      } else if((m = /^so (com|sem) (.+)$/.exec(f))){
        if(!PROPOSTA_MODELO_FLAGS[m[2]]){ erro(nl, `flag desconhecido "${m[2]}" (diesel, hospedagem ou alimentação)`); continue; }
        it.so = { flag: PROPOSTA_MODELO_FLAGS[m[2]], com: m[1] === "com" };
      } else erro(nl, `marcação de encargo desconhecida: "${f}"`);
    }
    if(!it.resp){ erro(nl, 'encargo sem responsável: CGL, CONTRATANTE, NÃO APLICA ou "CGL se <flag>"'); return; }
    r.encargos.push(it);
  });
  if(!r.encargos) erro(0, "falta a seção ## Encargos");
  if(!r.clausulas.length) erro(0, "falta ao menos uma seção ## Cláusulas: TÍTULO");
  r.clausulas.forEach(c => { if(!c.itens.length) erro(0, `a seção "${c.titulo}" está vazia`); });
  return r;
}


function propostaModeloAplicar(modelo, o){
  const orc = o || {};
  const d = orc.validade_dias || 30;
  const valores = { pagamento: () => _clausulaPagamento(orc), clausula_refuro: () => _clausulaRefuro(orc),
    validade_dias: () => `${d}`, validade_extenso: () => `${d === 30 ? "trinta" : d}` };
  const campos = (t) => String(t).replace(/\{\{\s*([^}]*?)\s*\}\}/g, (x, k) => valores[k] ? valores[k]() : x);
  const encargos = (modelo.encargos || [])
    .filter(it => !it.so || !!orc[it.so.flag] === it.so.com)
    .map(it => {
      const e = { d: campos(it.d), r: it.resp.fixo || (orc[it.resp.flag] ? "CGL" : "CONTRATANTE") };
      if(it.destaque) e.destaque = true;
      return e;
    });
  const clausulas = modelo.clausulas.map(c => ({ titulo: c.titulo,
    itens: c.itens.map(it => it.destaque ? { t: campos(it.t), destaque: true } : { t: campos(it.t) }) }));
  return { encargos, clausulas };
}


function propostaSecoesCodigo(tipo, o){
  return {
    encargos: encargosPorTipo(tipo, o),
    clausulas: [
      { titulo: "CRITÉRIOS DE MEDIÇÃO / CONDIÇÕES DE PAGAMENTOS", itens: criteriosMedicaoPorTipo(tipo, o) },
      { titulo: "CONDIÇÕES GERAIS", itens: condicoesGeraisPorTipo(tipo) },
      { titulo: "CONTRATAÇÃO DOS SERVIÇOS", itens: contratacaoServicosTextoComum() },
      { titulo: "VALIDADE DA PROPOSTA", itens: validadeTextoComum(o.validade_dias || 30) }
    ]
  };
}

function propostaSecoes(tipo, o, modelo){
  return modelo ? propostaModeloAplicar(modelo, o) : propostaSecoesCodigo(tipo, o);
}




async function propostaCarregarModelo(tipo){
  if(!PROPOSTA_SEGMENTOS_MODELO.includes(tipo)) return null;
  const { data, error } = await sb.from("vw_modelos_vigentes").select("versao_id,numero,texto,nome")
    .eq("tipo", "proposta").eq("segmento", tipo).maybeSingle();
  if(error){
    if(["42P01", "PGRST205", "PGRST200", "42703"].includes(error.code)) return null;
    throw new Error("Erro ao carregar o modelo da proposta: " + error.message);
  }
  if(!data) return null;
  const m = propostaModeloLer(data.texto);
  if(m.erros.length){
    const e = m.erros[0];
    throw new Error(`O modelo vigente "${data.nome}" (versão ${data.numero}) tem erro${e.linha ? " na linha " + e.linha : ""}: ${e.msg}. Avise o jurídico.`);
  }
  m.versao = data.numero;
  return m;
}


function blocoEncargos(encargos){
  if(!encargos || !encargos.length) return "";
  const linhaX = (it) => {
    const c = it.r === "CONTRATANTE" ? "X" : "";
    const g = it.r === "CGL"          ? "X" : "";
    const n = it.r === "NAO"          ? "X" : "";
    const cls = it.destaque ? "destaque" : "";
    return `<tr class="${cls}">
      <td>${siglasSemQuebra(esc(it.d))}</td>
      <td class="x">${esc(c)}</td>
      <td class="x">${g}</td>
      <td class="x">${n}</td>
    </tr>`;
  };
  return `
    <table class="encargos">
      <thead>
        <tr><th colspan="4">ENCARGOS DE RESPONSABILIDADE</th></tr>
        <tr>
          <th class="desc-col">DESCRIÇÃO</th>
          <th class="x-col">CONTRATANTE</th>
          <th class="x-col">CGL</th>
          <th class="x-col">Não Aplica</th>
        </tr>
      </thead>
      <tbody>${encargos.map(linhaX).join("")}</tbody>
    </table>`;
}


function blocoClausulas(titulo, itens){
  if(!itens || !itens.length) return "";
  return `
    <div class="clausulas">
      <div class="secao-titulo">${esc(titulo)}</div>
      ${itens.map(it => `<div class="item nao-quebrar ${it.destaque ? "destaque" : ""}">${esc(it.t)}</div>`).join("")}
    </div>`;
}




function montarHtmlProposta(dados){
  const { orcamento, itens, cliente, responsavel } = dados;
  const tipo = orcamento.tipo_proposta || "helice";
  const tInfo = PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro;
  const codigoModelo = orcamento.codigo_modelo || tInfo.codigo;
  const revisao      = orcamento.numero_revisao || "00";



  const itensQuadro = itens || [];
  const secoes = propostaSecoes(tipo, orcamento, dados.modelo);

  const corpo = `
    ${blocoCabecalho(tipo, codigoModelo, revisao)}
    ${blocoDestinatario(cliente, orcamento.cidade_emissao, orcamento.data_orcamento, orcamento)}
    ${blocoNumeroProposta(orcamento.numero, orcamento.data_orcamento, revisao)}
    ${blocoIntroducao(orcamento.referencia_obra || orcamento.descricao, tipo)}
    ${blocoCondicoesGerais(orcamento.escopo_servicos || orcamento.observacoes, orcamento.equipamento_considerado, orcamento)}
    ${blocoQuadroPrecos(itensQuadro, orcamento)}
    ${blocoNotaINSS()}
    ${blocoObservacoesItens(itensQuadro, dados.notasInternas)}
    ${blocoEncargos(secoes.encargos)}
    ${secoes.clausulas.map(c => blocoClausulas(c.titulo, c.itens)).join("")}
    ${blocoComercial(responsavel)}
    ${blocoDeAcordo()}
    ${blocoRodapeEmpresa()}
    ${pdfRodapeHTML()}
  `;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>Proposta ${esc(orcamento.numero || "")}</title>
<style>${CSS_PROPOSTA}</style>
</head><body>${  corpo}</body></html>`;
}











const PPDF_ESQ = 10, PPDF_LARG = 190, PPDF_TOPO = 12;
const PPDF_LIMITE = 297 - PDF_BASE_MIN_MM;
const PPDF_PT = 0.352778;
const PPDF_COR = { preto: [0, 0, 0], cinza: [217, 217, 217], cinzaEsc: [192, 192, 192], laranja: [249, 115, 22],
  laranjaEsc: [194, 65, 12], amarelo: [255, 247, 214], ambar: [161, 98, 7], branco: [255, 255, 255] };
const PPDF_NB = "\u0001";

function _ppFonte(pdf, estilo, tam, cor){
  pdf.setFont("helvetica", estilo || "normal");
  pdf.setFontSize(tam);
  pdf.setTextColor(...(cor || PPDF_COR.preto));
}
function _ppLh(tam){ return tam * PPDF_PT * 1.3; }
function _ppBase(y, h, tam){ return y + h / 2 + tam * PPDF_PT * 0.359; }
function _ppEstilo(p){ return p.b && p.i ? "bolditalic" : p.b ? "bold" : p.i ? "italic" : "normal"; }
function _ppPagina(L){ L.pdf.addPage("a4", "portrait"); L.y = PPDF_TOPO; }
function _ppGarantir(L, h){ if(L.y + h > PPDF_LIMITE && h <= PPDF_LIMITE - PPDF_TOPO && L.y > PPDF_TOPO + 0.1) _ppPagina(L); }


function _ppMarcado(s, base){
  const out = []; let b = !!(base && base.b), i = !!(base && base.i);
  String(s || "").split(/(<\/?[bi]>)/).forEach(p => {
    if(p === "<b>") b = true; else if(p === "</b>") b = false;
    else if(p === "<i>") i = true; else if(p === "</i>") i = false;
    else if(p) out.push({ t: p, b, i, cor: base && base.cor });
  });
  return out;
}


function _ppPalavras(pdf, trechos, tam){
  const palavras = []; let atual = null, espaco = true;
  trechos.forEach(tr => {
    const est = _ppEstilo(tr);
    const txt = String(tr.t ?? "").split(PPDF_NB).map(pdfTextoWinAnsi).join(PPDF_NB)
      .replace(/NBR-? (?=\d)/g, m => m.replace(" ", PPDF_NB));
    txt.split(/(\n| +)/).forEach(tok => {
      if(!tok) return;
      if(tok === "\n"){ palavras.push({ quebra: true }); atual = null; espaco = true; return; }
      if(/^ +$/.test(tok)){ espaco = true; return; }
      _ppFonte(pdf, est, tam);
      const t = tok.split(PPDF_NB).join(" ");
      const pedaco = { t, est, cor: tr.cor, w: pdf.getTextWidth(t) };
      if(atual && !espaco){ atual.pedacos.push(pedaco); atual.w += pedaco.w; }
      else { atual = { pedacos: [pedaco], w: pedaco.w }; palavras.push(atual); }
      espaco = false;
    });
  });
  return palavras;
}


function _ppCortarPalavra(pdf, p, larg, tam){
  if(p.w <= larg || p.pedacos.length !== 1) return [p];
  const pc = p.pedacos[0], partes = [];
  _ppFonte(pdf, pc.est, tam);
  let buf = "";
  for(const c of pc.t){
    if(buf && pdf.getTextWidth(buf + c) > larg){ partes.push(buf); buf = ""; }
    buf += c;
  }
  if(buf) partes.push(buf);
  return partes.map(t => { const w = pdf.getTextWidth(t); return { pedacos: [{ ...pc, t, w }], w }; });
}


function _ppLinhas(pdf, trechos, larg, tam){
  _ppFonte(pdf, "normal", tam);
  const esp = pdf.getTextWidth(" ");
  const linhas = [];
  let lin = { palavras: [], w: 0 };
  const fechar = (fim) => { lin.fim = fim; linhas.push(lin); lin = { palavras: [], w: 0 }; };
  _ppPalavras(pdf, trechos, tam).forEach(p => {
    if(p.quebra){ fechar(true); return; }
    _ppCortarPalavra(pdf, p, larg, tam).forEach(parte => {
      if(lin.palavras.length && lin.w + esp + parte.w > larg + 0.01) fechar(false);
      lin.w += lin.palavras.length ? esp + parte.w : parte.w;
      lin.palavras.push(parte);
    });
  });
  if(lin.palavras.length || !linhas.length) fechar(true);
  return { linhas, esp };
}


function _ppDesenharLinhas(pdf, info, linhas, x, y, larg, tam, alinh){
  const lh = _ppLh(tam);
  linhas.forEach((lin, k) => {
    const n = lin.palavras.length;
    if(!n) return;
    const base = _ppBase(y + k * lh, lh, tam);
    let gap = info.esp, cx = x;
    if(alinh === "justify" && !lin.fim && n > 1) gap = (larg - lin.palavras.reduce((s, p) => s + p.w, 0)) / (n - 1);
    else if(alinh === "center") cx = x + (larg - lin.w) / 2;
    else if(alinh === "right") cx = x + larg - lin.w;
    lin.palavras.forEach((p, j) => {
      p.pedacos.forEach((pc, m) => {
        _ppFonte(pdf, pc.est, tam, pc.cor);
        pdf.text(pc.t + (m === p.pedacos.length - 1 && j < n - 1 ? " " : ""), cx, base);
        cx += pc.w;
      });
      cx += gap;
    });
  });
}

function _ppRet(pdf, x, y, w, h, fundo, borda, semTopo){
  if(fundo){ pdf.setFillColor(...fundo); pdf.rect(x, y, w, h, "F"); }
  if(!borda) return;
  pdf.setDrawColor(0); pdf.setLineWidth(0.25);
  if(semTopo){ pdf.line(x, y, x, y + h); pdf.line(x + w, y, x + w, y + h); pdf.line(x, y + h, x + w, y + h); }
  else pdf.rect(x, y, w, h, "S");
}
function _ppTextoCentro(pdf, txt, x, y, w, h, tam, est, cor){
  _ppFonte(pdf, est, tam, cor);
  pdf.text(pdfTextoWinAnsi(txt), x + w / 2, _ppBase(y, h, tam), { align: "center" });
}



function _ppOpCaixa(op){ return Object.assign({ tam: 9.5, alinh: "left", padX: 0, padY: 0, antes: 0, junto: true }, op); }
function _ppAlturaCaixa(L, trechos, op){
  const o = _ppOpCaixa(op);
  return o.antes + _ppLinhas(L.pdf, trechos, PPDF_LARG - 2 * o.padX, o.tam).linhas.length * _ppLh(o.tam) + 2 * o.padY;
}
function _ppCaixa(L, trechos, op){
  const o = _ppOpCaixa(op), pdf = L.pdf, lh = _ppLh(o.tam), largTxt = PPDF_LARG - 2 * o.padX;
  const info = _ppLinhas(pdf, trechos, largTxt, o.tam);
  let resto = info.linhas;
  L.y += o.antes;
  if(o.junto) _ppGarantir(L, resto.length * lh + 2 * o.padY);
  while(resto.length){
    const cabe = Math.floor((PPDF_LIMITE - L.y - 2 * o.padY) / lh + 1e-6);
    if(cabe < 1){ _ppPagina(L); continue; }
    const fatia = resto.slice(0, cabe);
    resto = resto.slice(cabe);
    const h = fatia.length * lh + 2 * o.padY;
    _ppRet(pdf, PPDF_ESQ, L.y, PPDF_LARG, h, o.fundo, o.borda, o.semTopo);
    _ppDesenharLinhas(pdf, info, fatia, PPDF_ESQ + o.padX, L.y + o.padY, largTxt, o.tam, o.alinh);
    L.y += h;
    if(resto.length) _ppPagina(L);
  }
}
const PPDF_TITULO = { tam: 9.5, alinh: "center", padY: 1.06, fundo: PPDF_COR.cinza, borda: true };
function _ppTitulo(t){ return [{ t, b: true }]; }




function _ppTabela(L, cols, cab, corpo, op){
  const o = Object.assign({ tam: 9.5, padX: 1.6, padY: 1.06, antes: 0 }, op), pdf = L.pdf;
  const medir = (lin) => {
    let x = PPDF_ESQ, c = 0;
    lin._h = 0;
    lin._cels = lin.cels.map(cel => {
      const span = cel.span || 1, w = cols.slice(c, c + span).reduce((s, v) => s + v, 0);
      c += span;
      const padX = cel.padX ?? o.padX;
      const trechos = cel.trechos || [{ t: cel.semQuebra ? String(cel.t ?? "").replace(/[  ]/g, PPDF_NB) : String(cel.t ?? ""),
        b: cel.b, i: cel.i, cor: cel.cor }];
      let tam = cel.tam || lin.tam || o.tam;
      let info = _ppLinhas(pdf, trechos, w - 2 * padX, tam);
      while(cel.semQuebra && info.linhas.length > 1 && tam > 5.5){ tam -= 0.5; info = _ppLinhas(pdf, trechos, w - 2 * padX, tam); }
      const r = { x, w, tam, info, cel, padX, h: info.linhas.length * _ppLh(tam) + 2 * o.padY };
      x += w;
      lin._h = Math.max(lin._h, r.h);
      return r;
    });
  };
  const desenhar = (lin) => {
    lin._cels.forEach(r => {
      _ppRet(pdf, r.x, L.y, r.w, lin._h, r.cel.fundo || lin.fundo, true);
      _ppDesenharLinhas(pdf, r.info, r.info.linhas, r.x + r.padX, L.y + o.padY, r.w - 2 * r.padX, r.tam, r.cel.alinh || "left");
    });
    L.y += lin._h;
  };
  cab.forEach(medir);
  corpo.forEach(medir);
  L.y += o.antes;
  _ppGarantir(L, cab.reduce((s, l) => s + l._h, 0) + (corpo[0] ? corpo[0]._h : 0));
  cab.forEach(desenhar);
  corpo.forEach(lin => {
    if(L.y + lin._h > PPDF_LIMITE){ _ppPagina(L); cab.forEach(desenhar); }
    desenhar(lin);
  });
}


function _ppCabecalho(L, tipo, codigo, rev, logo){
  const pdf = L.pdf, x = PPDF_ESQ, y = L.y, t = PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro;
  const wLogo = 24, wMeta = 34, wMeio = PPDF_LARG - wLogo - wMeta;
  const h1 = 5.5, hMeta = 4.6, h2 = hMeta * 4, hTipo = 4.4;
  _ppRet(pdf, x, y, wLogo, h1 + h2, null, true);
  if(logo) pdf.addImage(logo, "PNG", x + (wLogo - 18) / 2, y + (h1 + h2 - 18) / 2, 18, 18, "logo-cgl", "FAST");
  _ppRet(pdf, x + wLogo, y, wMeio + wMeta, h1, null, true);
  _ppTextoCentro(pdf, "Sistema de Gestão da Qualidade", x + wLogo, y, wMeio + wMeta, h1, 8.5, "normal");
  _ppRet(pdf, x + wLogo, y + h1, wMeio, hTipo, PPDF_COR.cinzaEsc, false);
  _ppRet(pdf, x + wLogo, y + h1, wMeio, h2, null, true);
  _ppFonte(pdf, "normal", 8.5);
  pdf.text("Tipo de Documento", x + wLogo + 1.6, _ppBase(y + h1, hTipo, 8.5));
  _ppTextoCentro(pdf, "PROPOSTA COMERCIAL - " + t.rotulo, x + wLogo, y + h1 + hTipo, wMeio, h2 - hTipo, 12, "bold");
  const xm = x + wLogo + wMeio;
  [["Identificação", true], [codigo || t.codigo, false], ["Revisão", true], [rev || t.revisao_padrao, false]].forEach(([txt, lbl], k) => {
    const yy = y + h1 + k * hMeta;
    _ppRet(pdf, xm, yy, wMeta, hMeta, lbl ? PPDF_COR.laranja : null, true);
    if(lbl){ _ppFonte(pdf, "bold", 7, PPDF_COR.branco); pdf.text(pdfTextoWinAnsi(txt), xm + 1.2, _ppBase(yy, hMeta, 7)); }
    else _ppTextoCentro(pdf, txt, xm, yy, wMeta, hMeta, 7.5, "normal");
  });
  L.y = y + h1 + h2;
}


function _ppDestinatario(L, cliente, o){
  const pdf = L.pdf, c = cliente || {};
  L.y += 2.6;
  _ppFonte(pdf, "normal", 9);
  pdf.text(pdfTextoWinAnsi((o.cidade_emissao || "Itabira/MG") + ", " + dataPorExtensoBR(o.data_orcamento)),
    PPDF_ESQ + PPDF_LARG, _ppBase(L.y, _ppLh(9.5), 9), { align: "right" });
  _ppCaixa(L, [{ t: "À" }], { junto: false });
  _ppCaixa(L, [{ t: c.nome_fantasia || c.nome || "—", b: true }], { tam: 14, junto: false });
  _ppCaixa(L, [{ t: [
    "Razão Social: " + (c.nome || ""),
    "CNPJ de faturamento: " + (c.cpf_cnpj || ""),
    "E-mail: " + (o.contato_email || c.email || ""),
    "A/c: " + (o.contato_nome || c.contato_nome || ""),
    "Tel.: " + (o.contato_telefone || c.telefone || "")
  ].join("\n") }], { tam: 9, antes: 1, junto: false });
}


function _ppNumero(L, o, rev){
  const pdf = L.pdf;
  const partes = [
    { t: "PROPOSTA CONTRATO: ", tam: 12, cor: PPDF_COR.laranjaEsc },
    { t: orcNumeroExibicao(o.numero, o.data_orcamento), tam: 14, cor: PPDF_COR.laranjaEsc },
    { t: "REV: " + rev, tam: 9, cor: PPDF_COR.preto, antes: 5.3 }
  ].map(p => { _ppFonte(pdf, "bold", p.tam); p.t = pdfTextoWinAnsi(p.t); p.w = pdf.getTextWidth(p.t); return p; });
  L.y += 3.7;
  const h = _ppLh(14), base = _ppBase(L.y, h, 12);
  let x = PPDF_ESQ + (PPDF_LARG - partes.reduce((s, p) => s + p.w + (p.antes || 0), 0)) / 2;
  partes.forEach(p => { x += p.antes || 0; _ppFonte(pdf, "bold", p.tam, p.cor); pdf.text(p.t, x, base); x += p.w; });
  L.y += h + 1.6;
}


function _ppCondicoesGerais(L, o){
  const escopo = String(o.escopo_servicos || o.observacoes || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const ressalva = _propostaRessalva(o);
  const tr = [{ t: "Baseado nas informações fornecidas por V. Sas., previmos executar as estacas conforme discriminado abaixo:\n", i: true }];
  (escopo.length ? escopo : ["Escopo a ser preenchido na ficha do orçamento."])
    .forEach(l => tr.push({ t: "• " + l + "\n", b: true, i: true, cor: PPDF_COR.ambar }));
  if(ressalva) tr.push({ t: ressalva + "\n", i: true });
  if(o.equipamento_considerado) tr.push({ t: "Considerado equipamento " + o.equipamento_considerado + ".\n", i: true });
  if(o.local_execucao) tr.push({ t: "Local de execução: ", i: true }, { t: o.local_execucao + "\n", b: true, i: true });
  if(o.prazo_execucao) tr.push({ t: "Prazo de execução previsto: ", i: true }, { t: o.prazo_execucao + "\n", b: true, i: true });
  const opT = { ...PPDF_TITULO, antes: 2.6 }, opC = { alinh: "center", padX: 2.6, padY: 1.6, fundo: PPDF_COR.amarelo, borda: true, semTopo: true };
  _ppGarantir(L, _ppAlturaCaixa(L, _ppTitulo("x"), opT) + _ppAlturaCaixa(L, tr, opC));
  _ppCaixa(L, _ppTitulo("CONDIÇÕES GERAIS DA PROPOSTA"), opT);
  _ppCaixa(L, tr, opC);
}


function _ppQuadroPrecos(L, itens, o){
  if(!itens.length){
    _ppCaixa(L, _ppTitulo("Quadro de Preços"), { ...PPDF_TITULO, antes: 2.1 });
    _ppCaixa(L, [{ t: "Sem itens cadastrados.", i: true }], { alinh: "center", padY: 1.6, fundo: PPDF_COR.amarelo, borda: true, semTopo: true });
    return;
  }
  const tot = calcularTotaisProposta(itens, o), quadro = _propostaLinhasQuadro(itens);
  const cols = [106.4, 17.1, 17.1, 22.8, 26.6];
  const tit = (t) => ({ t, b: true, alinh: "center", semQuebra: true });
  const cab = [
    { fundo: PPDF_COR.cinza, tam: 9, cels: [{ t: "Quadro de Preços: Seguem abaixo os preços unitários para execução dos serviços.", span: 5, b: true, alinh: "center" }] },
    { fundo: PPDF_COR.cinza, tam: 9, cels: [tit("ITEM"), tit("Unidade"), tit("Quant."), tit("Valor Unit (R$)"), tit("Valor Total (R$)")] }
  ];
  const corpo = quadro.linhas.map(l => {
    if(l.secao) return { fundo: PPDF_COR.cinza, cels: [{ t: l.secao, span: 5, b: true, alinh: "center" }] };
    const it = l.it, qtd = Number(it.quantidade || 0), vu = Number(it.valor_unitario || 0);
    return { cels: [
      { t: l.num + "- " + (it.descricao || "") },
      { t: it.unidade || "", alinh: "center" },
      { t: qtd ? num(qtd) : "–", alinh: "center" },
      { t: brl(vu), alinh: "right", semQuebra: true },
      { t: qtd ? brl(qtd * vu) : "–", alinh: qtd ? "right" : "center", semQuebra: true }
    ] };
  });
  if(tot.iss > 0) corpo.push({ cels: [{ t: quadro.proximo + "- " + tot.rotulo }, { t: "" }, { t: "" }, { t: "" },
    { t: brl(tot.iss), alinh: "right", semQuebra: true }] });
  corpo.push({ fundo: PPDF_COR.cinza, cels: [{ t: "Valor Total Estimado", span: 4, b: true, alinh: "right" },
    { t: brl(tot.total), b: true, alinh: "right", semQuebra: true }] });
  _ppTabela(L, cols, cab, corpo, { antes: 2.1 });
}


function _ppEncargos(L, encargos){
  if(!encargos || !encargos.length) return;
  const tit = (t) => ({ t, b: true, alinh: "center", semQuebra: true });
  const cab = [
    { fundo: PPDF_COR.cinza, tam: 9, cels: [{ t: "ENCARGOS DE RESPONSABILIDADE", span: 4, b: true, alinh: "center" }] },
    { fundo: PPDF_COR.cinza, tam: 9, cels: [{ t: "DESCRIÇÃO", b: true, padX: 2.1 }, tit("CONTRATANTE"), tit("CGL"), tit("Não Aplica")] }
  ];
  const x = (v) => ({ t: v ? "X" : "", b: true, alinh: "center" });
  const corpo = encargos.map(it => ({ fundo: it.destaque ? PPDF_COR.amarelo : null,
    cels: [{ t: it.d }, x(it.r === "CONTRATANTE"), x(it.r === "CGL"), x(it.r === "NAO")] }));
  _ppTabela(L, [121.6, 22.8, 22.8, 22.8], cab, corpo, { antes: 3.2 });
}


function _ppClausulas(L, titulo, itens){
  if(!itens || !itens.length) return;
  const opT = { ...PPDF_TITULO, antes: 3.2 };
  const opI = { tam: 8.5, alinh: "justify", padX: 1.6, padY: 1.06, borda: true, semTopo: true };
  const tr = (it) => [{ t: it.t, b: !!it.destaque, i: !!it.destaque }];
  _ppGarantir(L, _ppAlturaCaixa(L, _ppTitulo(titulo), opT) + _ppAlturaCaixa(L, tr(itens[0]), opI));
  _ppCaixa(L, _ppTitulo(titulo), opT);
  itens.forEach(it => _ppCaixa(L, tr(it), opI));
}


function _ppComercial(L, responsavel){
  const pdf = L.pdf, r = responsavel || {};
  const linhas = [{ t: (r.nome || "—") + "\n", b: true }, { t: _propostaCargo(r.cargo) + "\n" }];
  if(r.telefone) linhas.push({ t: "Cel.: " + _propostaTelefone(r.telefone) + "\n" });
  if(r.email) linhas.push({ t: r.email + "\n" });
  linhas.push({ t: CGL_INFO.site });
  const opC = { tam: 9, alinh: "center", antes: 2.1 };
  _ppGarantir(L, 3.7 + 8 + _ppLh(9.5) + 1 + _ppAlturaCaixa(L, linhas, opC));
  L.y += 3.7 + 8;
  const meio = PPDF_ESQ + PPDF_LARG / 2;
  pdf.setDrawColor(0); pdf.setLineWidth(0.25);
  pdf.line(meio - 37, L.y, meio + 37, L.y);
  L.y += 1;
  _ppTextoCentro(pdf, CGL_INFO.razao_social, PPDF_ESQ, L.y, PPDF_LARG, _ppLh(9.5), 9.5, "normal");
  L.y += _ppLh(9.5);
  _ppCaixa(L, linhas, opC);
}


function _ppDeAcordo(L){
  const pdf = L.pdf;
  const obs = [{ t: "Obs: Favor enviar junto com o \"De acordo\" última alteração contratual e caso não seja assinado pelo representante legal da empresa enviar procuração." }];
  const opO = { tam: 8, padX: 2.1, padY: 1.06, borda: true };
  const hCorpo = 2.1 + 3.7 + _ppLh(11) + 1 + _ppLh(8.5) + 2.1;
  _ppGarantir(L, 2.6 + hCorpo + _ppAlturaCaixa(L, obs, opO));
  L.y += 2.6;
  const y0 = L.y;
  _ppRet(pdf, PPDF_ESQ, y0, PPDF_LARG, hCorpo, null, true);
  const yTxt = y0 + 2.1 + 3.7, txt = "De acordo: Em ___/___/____. ";
  _ppFonte(pdf, "bold", 11);
  const x = PPDF_ESQ + 2.1, base = _ppBase(yTxt, _ppLh(11), 11);
  pdf.text(txt, x, base);
  const xl = x + pdf.getTextWidth(txt);
  pdf.setDrawColor(0); pdf.setLineWidth(0.25);
  pdf.line(xl, base + 0.6, xl + (PPDF_LARG - 4.2) / 2, base + 0.6);
  _ppTextoCentro(pdf, "(Assinatura e Carimbo)", PPDF_ESQ, yTxt + _ppLh(11) + 1, PPDF_LARG, _ppLh(8.5), 8.5, "normal");
  L.y = y0 + hCorpo;
  _ppCaixa(L, obs, { ...opO, junto: false });
}


async function gerarPropostaPdfTexto(dados){
  const { orcamento: o, itens, cliente, responsavel } = dados;
  const tipo = o.tipo_proposta || "helice";
  const tInfo = PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro;
  const rev = o.numero_revisao || "00";
  const itensQuadro = itens || [];
  const pdf = await pdfNovoDocumento();
  const logo = await pdfCarregarImagem(PDF_LOGO_SRC, 300).catch(() => null);
  const selo = await pdfCarregarImagem(PDF_SELO_SRC, 300).catch(() => null);
  const L = { pdf, y: PPDF_TOPO };

  _ppCabecalho(L, tipo, o.codigo_modelo || tInfo.codigo, rev, logo);
  _ppDestinatario(L, cliente, o);
  _ppNumero(L, o, rev);
  _ppCaixa(L, [{ t: "Proposta contrato para execução de Fundações Especiais por empreitada com emprego de todos materiais e apuração através de medições das quantidades por preços unitários, conforme dados e condições abaixo:" }],
    { alinh: "justify", antes: 1 });
  _ppCaixa(L, [{ t: "Ref:", b: true }, { t: " Execução de estacas tipo " }, { t: tInfo.rotulo, b: true }, { t: " " + (o.referencia_obra || o.descricao || "") }],
    { antes: 1.6 });
  _ppCaixa(L, _ppMarcado(TEXTO_INSTITUCIONAL), { alinh: "justify", antes: 2.6 });
  _ppCondicoesGerais(L, o);
  _ppQuadroPrecos(L, itensQuadro, o);
  _ppCaixa(L, [{ t: NOTA_INSS }], { tam: 7.5, alinh: "justify", padX: 1.6, padY: 1.06, borda: true, semTopo: true });
  _propostaObservacoes(itensQuadro, dados.notasInternas).forEach((t, k) =>
    _ppCaixa(L, [{ t }], { tam: 8.5, padX: 1.6, padY: 1.06, borda: true, semTopo: k > 0, antes: k ? 0 : 2.1 }));
  const secoes = propostaSecoes(tipo, o, dados.modelo);
  _ppEncargos(L, secoes.encargos);
  secoes.clausulas.forEach(c => _ppClausulas(L, c.titulo, c.itens));
  _ppComercial(L, responsavel);
  _ppDeAcordo(L);
  _ppCaixa(L, [
    { t: CGL_INFO.endereco + "   FONE: " + CGL_INFO.telefone + "\n", b: true },
    { t: "E-mail: " + CGL_INFO.emails + "\n" },
    { t: "Site: " + CGL_INFO.site }
  ], { tam: 8, alinh: "center", padX: 1.6, padY: 1.6, borda: true, semTopo: true });

  pdfCarimbarRodape(pdf, selo, [PPDF_TOPO, PPDF_ESQ, PDF_BASE_MIN_MM, PPDF_ESQ]);
  const c = cliente || {};
  pdf.setProperties({
    title: pdfTextoWinAnsi("Proposta " + orcNumeroExibicao(o.numero, o.data_orcamento) + " - " + (c.nome_fantasia || c.nome || "")),
    subject: "Proposta comercial", author: "CGL Fundações", creator: "Controle CGL"
  });
  return pdf;
}







async function propostaNotasInternas(itens){
  if(!itens.some(i => i.observacao && i.observacao.trim())) return new Set();
  const { data, error } = await sb.from("servicos").select("nota_interna").not("nota_interna", "is", null);
  if(error) throw new Error("Erro ao carregar as notas do catálogo: " + error.message);
  return new Set((data || []).map(s => (s.nota_interna || "").trim()).filter(Boolean));
}


async function carregarDadosProposta(orcamentoId){
  const { data:orc, error:eOrc } = await sb.from("orcamentos")
    .select("*").eq("id", orcamentoId).single();
  if(eOrc) throw new Error("Erro ao carregar orçamento: " + eOrc.message);

  const { data:itens, error:eIt } = await sb.from("orcamento_itens")
    .select("*").eq("orcamento_id", orcamentoId).order("ordem");
  if(eIt) throw new Error("Erro ao carregar itens: " + eIt.message);

  let cliente = null;
  if(orc.cliente_id){
    const { data:c } = await sb.from("clientes").select("*").eq("id", orc.cliente_id).single();
    cliente = c;
  }

  let responsavel = null;
  if(orc.responsavel_id){
    const { data:r } = await sb.from("profiles").select("*").eq("id", orc.responsavel_id).single();
    responsavel = r;
  }

  if(!responsavel){
    const { data:{ user } } = await sb.auth.getUser();
    if(user){
      const { data:p } = await sb.from("profiles").select("*").eq("id", user.id).single();
      responsavel = p;
    }
  }


  const notasInternas = await propostaNotasInternas(itens || []);


  const modelo = await propostaCarregarModelo(orc.tipo_proposta || "helice");

  return { orcamento: orc, itens: itens || [], cliente, responsavel, notasInternas, modelo };
}


async function visualizarProposta(orcamentoId){
  try {
    const dados = await carregarDadosProposta(orcamentoId);
    const html  = montarHtmlProposta(dados);
    const w = window.open("", "_blank");
    if(!w){ aviso("app-aviso","Pop-up bloqueado. Permita pop-ups para visualizar a proposta.","erro"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  } catch(err){
    aviso("app-aviso", err.message || "Erro ao gerar a visualização.", "erro");
  }
}



async function baixarProposta(orcamentoId){
  try {
    const dados = await carregarDadosProposta(orcamentoId);
    const nomeArq = propostaNomeArquivo(dados.orcamento, dados.cliente);

    try {
      const pdf = await gerarPropostaPdfTexto(dados);
      pdf.save(nomeArq);
      return;
    } catch(errTexto){
      console.error("Proposta: o PDF com texto falhou; gerando pelo modo antigo (imagem).", errTexto);
    }
    const html  = montarHtmlProposta(dados);


    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const doc = wrap.querySelector("body") || wrap;


    await pdfGerar(doc, { filename: nomeArq });
  } catch(err){
    aviso("app-aviso", err.message || "Erro ao gerar o PDF.", "erro");
  }
}



async function gerarPropostaPdfBlob(orcamentoId){
  const dados = await carregarDadosProposta(orcamentoId);
  const pdf = await gerarPropostaPdfTexto(dados);
  return pdf.output("blob");
}


const btnVerProposta = $("btn-ver-proposta");
if(btnVerProposta){
  btnVerProposta.addEventListener("click", () => {
    if(!orcEditId){
      aviso("app-aviso","Salve o orçamento antes de visualizar a proposta.","erro");
      return;
    }
    visualizarProposta(orcEditId);
  });
}

const btnBaixarProposta = $("btn-baixar-proposta");
if(btnBaixarProposta){
  btnBaixarProposta.addEventListener("click", () => {
    if(!orcEditId){
      aviso("app-aviso","Salve o orçamento antes de baixar o PDF.","erro");
      return;
    }
    baixarProposta(orcEditId);
  });
}

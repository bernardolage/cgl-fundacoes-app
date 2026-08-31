/* ====================================================================
   Módulo: Propostas (geração de PDF a partir do orçamento)
   Renderiza o orçamento como uma Proposta Comercial CGL (modelos
   RG 11.8 HÉLICE, RG 11.9 TRADO, RG 11.10 RAIZ e RG 11.11 SECANTE).

   Arquitetura:
     - Funções `bloco*` retornam fragmentos HTML reutilizáveis.
     - Funções `conteudo*` retornam blocos específicos por tipo
       de proposta (encargos, cláusulas, observações).
     - `montarHtmlProposta(dados)` monta o documento final.
     - `visualizarProposta(orcId)` abre o PDF em nova aba.
     - `baixarProposta(orcId)` salva o PDF no disco.

   Dependência externa: html2pdf.js (carregado no index.html).
   ==================================================================== */

/* ---------- Dados institucionais (constantes) ---------- */
const CGL_INFO = {
  razao_social: "CGL FUNDAÇÕES LTDA",
  endereco:     "AVENIDA HEMATITA, 562 – DISTRITO INDUSTRIAL - ITABIRA / MG",
  telefone:     "(31) 3833-4100",
  emails:       "sergio@cglfundacoes.com.br / bernardo@cglfundacoes.com.br / vitorhugo@cglfundacoes.com.br",
  site:         "www.cglfundacoes.com.br"
};

/* Logo da CGL — quando tivermos o arquivo, basta colar o data URL aqui
   (ex.: "data:image/png;base64,iVBORw0KGgoAAA..."). Enquanto vazio,
   o cabeçalho usa um SVG de fallback estilizado abaixo. */
const LOGO_CGL_DATAURL = "";

/* SVG inline de fallback (caso LOGO_CGL_DATAURL esteja vazia).
   Aproxima a identidade visual: gradiente laranja em forma de prisma com
   "CGL" sobreposto e "FUNDAÇÕES" embaixo. */
const LOGO_CGL_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="100%" height="100%">
  <defs>
    <linearGradient id="lcgl" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#fb923c"/>
      <stop offset="55%" stop-color="#ea580c"/>
      <stop offset="100%" stop-color="#9a3412"/>
    </linearGradient>
  </defs>
  <polygon points="60,8 95,55 25,55" fill="url(#lcgl)" stroke="#7c2d12" stroke-width="1"/>
  <polygon points="60,18 82,52 38,52" fill="none" stroke="#fff7ed" stroke-width="0.6"/>
  <text x="60" y="45" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
        font-size="20" font-weight="900" fill="#fff" letter-spacing="1">CGL</text>
  <text x="60" y="72" text-anchor="middle" font-family="Arial, sans-serif"
        font-size="9" font-weight="700" fill="#7c2d12" letter-spacing="3">FUNDAÇÕES</text>
</svg>`;

/* devolve o HTML do logo (imagem real se houver data URL, senão SVG inline) */
function obterLogoHTML(){
  if(LOGO_CGL_DATAURL && LOGO_CGL_DATAURL.startsWith("data:")){
    return `<img src="${LOGO_CGL_DATAURL}" alt="CGL Fundações" style="max-width:100%;max-height:70px;">`;
  }
  return LOGO_CGL_SVG;
}

/* mapa tipo_proposta -> rótulo + código RG */
const PROPOSTA_TIPOS = {
  helice:  { rotulo: "HÉLICE",  codigo: "RG 11.8",  revisao_padrao: "01 - 03/06/2024" },
  trado:   { rotulo: "TRADO",   codigo: "RG 11.9",  revisao_padrao: "01 - 03/06/2024" },
  raiz:    { rotulo: "RAÍZ",    codigo: "RG 11.10", revisao_padrao: "01 - 03/06/2024" },
  secante: { rotulo: "SECANTE", codigo: "RG 11.11", revisao_padrao: "01 - 03/06/2024" },
  outro:   { rotulo: "PROPOSTA",codigo: "RG 11.0",  revisao_padrao: "01" }
};

/* parágrafo institucional padrão (texto "Desde 1997...") */
const TEXTO_INSTITUCIONAL =
  'Desde 1997, a CGL FUNDAÇÕES, <b>ESPECIALIZADA EM ESTACA HÉLICE CONTÍNUA MONITORADA, ' +
  'ESTACA SECANTE (PAREDE DIAFRAGMA COM ESTACAS SECANTES), ESTACAS RAIZ, TIRANTES, SOLO ' +
  'GRAMPEADO, PERFURAÇÃO DE POÇOS, ESTACA PRESSOANCORAGEM, ESCAVADAS TRADO MECANIZADO, ' +
  'MARTELO HIDRÁULICO (CRAVAÇÃO ESTACAS METÁLICAS E ESTACAS CONCRETO PRÉ-MOLDADO),</b> ' +
  'vem atender a solicitação de V. Sas. e apresentar nossa <b>proposta</b> para execução ' +
  'dos serviços em referência nas condições abaixo discriminadas.';

/* nota de rodapé sobre retenção INSS, comum a todos os modelos */
const NOTA_INSS =
  '* Conforme inciso VI do artigo 30 da Lei 8.212/91 e em conformidade com o inciso II do parágrafo 3° ' +
  'do artigo 220 do Decreto 3.048/99 e Instrução Normativa nº 2110/2022 ART 130 PARÁGRAFO 1º, não se ' +
  'aplicam às disposições de retenção de 11% para os serviços geotécnicos e de fundações, tais como, ' +
  'obras de contenção e tirantes, sondagens, estacas, sapatas, fundações especiais, etc.';

/* ---------- Helpers de formatação ---------- */

/* "2026-07-01" -> "01 Julho de 2026" (formato do cabeçalho dos modelos) */
function dataPorExtensoBR(iso){
  if(!iso) return "";
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                 "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const p = String(iso).slice(0,10).split("-");
  if(p.length !== 3) return iso;
  return `${p[2]} ${meses[Number(p[1])-1]} de ${p[0]}`;
}

/* "2026-07-01" -> "2026" */
function anoDe(iso){
  if(!iso) return new Date().getFullYear();
  return String(iso).slice(0,4);
}

/* "ORC-0007" -> "0007" (extrai dígitos para mostrar como "NNNN / AAAA") */
function numeroLimpo(s){
  const m = String(s||"").match(/\d+/g);
  return m ? m.join("").padStart(4,"0") : "0000";
}

/* ---------- CSS embutido para impressão A4 ---------- */
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
  .cab-logo svg, .cab-logo img { display:block; margin:0 auto; max-height: 70px; max-width: 80px; }
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
  .quadro-precos .col-vu   { width: 12%; text-align:right; }
  .quadro-precos .col-vt   { width: 14%; text-align:right; }
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

/* ---------- Blocos reutilizáveis ---------- */

/* cabeçalho institucional com logo, identificação do documento e meta-dados */
function blocoCabecalho(tipo, codigoModelo, revisao, paginaAtual, paginaTotal){
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
            <tr><td class="lbl">Página</td></tr>
            <tr><td class="val">${paginaAtual} de ${paginaTotal}</td></tr>
          </table>
        </td>
      </tr>
    </table>`;
}

/* bloco de identificação do destinatário (cliente) + cidade/data */
function blocoDestinatario(cliente, cidadeEmissao, dataOrcamento){
  if(!cliente) cliente = {};
  return `
    <div class="destinatario">
      <div class="data-cidade">${esc(cidadeEmissao || "Itabira/MG")}, ${esc(dataPorExtensoBR(dataOrcamento))}</div>
      <div>À</div>
      <div class="cli-nome">${esc(cliente.nome_fantasia || cliente.nome || "—")}</div>
      <div class="campos">
        <div>Razão Social: ${esc(cliente.nome || "")}</div>
        <div>CNPJ de faturamento: ${esc(cliente.cpf_cnpj || "")}</div>
        <div>E-mail: ${esc(cliente.email || "")}</div>
        <div>A/c: ${esc(cliente.contato_nome || "")}</div>
        <div>Tel.: ${esc(cliente.telefone || "")}</div>
      </div>
    </div>`;
}

/* faixa central com o número da proposta */
function blocoNumeroProposta(numero, dataOrcamento, revisao){
  const num = numeroLimpo(numero);
  const ano = anoDe(dataOrcamento);
  return `
    <div class="numero-proposta">
      PROPOSTA CONTRATO: <span class="num">${num} / ${ano}</span>
      <span class="rev">REV: ${esc(revisao || "")}</span>
    </div>`;
}

/* parágrafo introdutório + referência da obra */
function blocoIntroducao(referenciaObra, tipo){
  const tipoNome = (PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro).rotulo;
  return `
    <div class="par-intro">
      Proposta contrato para execução de Fundações Especiais por empreitada com emprego de todos
      materiais e apuração através de medições das quantidades por preços unitários, conforme dados
      e condições abaixo:
    </div>
    <div class="par-ref">
      <b>Ref:</b> Execução de estacas tipo <b>${esc(tipoNome)}</b> ${esc(referenciaObra || "")}
    </div>
    <div class="par-intro">${TEXTO_INSTITUCIONAL}</div>`;
}

/* bloco "CONDIÇÕES GERAIS DA PROPOSTA" com escopo dos serviços.
   A cláusula de ressalva sobre projeto/sondagem só aparece quando o
   cliente NÃO forneceu o projeto de fundação ou a sondagem
   (campo orcamentos.projeto_sondagem_fornecido = false). */
function blocoCondicoesGerais(escopo, equipamento, projetoSondagemFornecido){
  const linhas = (escopo || "").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const escopoHTML = linhas.length
    ? linhas.map(l => `<div class="escopo">• ${esc(l)}</div>`).join("")
    : `<div class="escopo">• Escopo a ser preenchido na ficha do orçamento.</div>`;
  const mostraRessalva = projetoSondagemFornecido !== true;
  return `
    <div class="secao-titulo">CONDIÇÕES GERAIS DA PROPOSTA</div>
    <div class="cond-gerais">
      <div>Baseado nas informações fornecidas por V. Sas., previmos executar as estacas conforme discriminado abaixo:</div>
      ${escopoHTML}
      ${mostraRessalva ? `<div><i>Proposta sujeita a alteração após análise de projeto e sondagem.</i></div>` : ""}
      ${equipamento ? `<div><i>Considerado equipamento ${esc(equipamento)}.</i></div>` : ""}
    </div>`;
}

/* itens virtuais gerados a partir dos flags do orçamento (CGL fornece...) */
function itensVirtuais(orcamento){
  const extras = [];
  if(orcamento.cgl_fornece_diesel){
    extras.push({
      descricao:      "Diesel (fornecido pela CGL)",
      quantidade:     1,
      unidade:        "l",
      valor_unitario: Number(orcamento.diesel_preco_litro || 8.34),
      _virtual:       true
    });
  }
  if(orcamento.cgl_fornece_hospedagem){
    extras.push({
      descricao:      "Hospedagem e alimentação externa (fornecidas pela CGL)",
      quantidade:     1,
      unidade:        "mês",
      valor_unitario: Number(orcamento.hospedagem_valor_mensal || 0),
      _virtual:       true
    });
  }
  return extras;
}

/* quadro de preços com auto-numeração 1, 2, ..., 7.1, 7.2 quando há `secao` */
function blocoQuadroPrecos(itens, valorTotal){
  if(!itens || !itens.length){
    return `
      <div class="secao-titulo" style="margin-top:8px;">Quadro de Preços</div>
      <div class="cond-gerais" style="text-align:center;">Sem itens cadastrados.</div>`;
  }

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

  /* auto-numeração: secao define agrupador (N), subitens recebem N.1, N.2 */
  let nivel = 1;             /* próximo número de seção/item individual */
  let secaoAtual = null;     /* nome da seção corrente */
  let secaoNumero = null;    /* número atribuído à seção corrente */
  let subIndex = 0;          /* contador dentro da seção */

  itens.forEach(it => {
    const temSecao = it.secao && it.secao.trim();
    let rotuloNum;

    if(temSecao){
      if(it.secao !== secaoAtual){
        /* nova seção: imprime linha-agrupador e reseta sub-índice */
        secaoAtual  = it.secao;
        secaoNumero = nivel;
        subIndex    = 0;
        html += `<tr class="item-secao"><td colspan="6">${secaoNumero}- ${esc(it.secao)}</td></tr>`;
        nivel++;
      }
      subIndex++;
      rotuloNum = `${secaoNumero}.${subIndex}`;
    } else {
      secaoAtual = null;
      rotuloNum  = String(nivel);
      nivel++;
    }

    const qtd = Number(it.quantidade || 0);
    const vu  = Number(it.valor_unitario || 0);
    const vt  = qtd * vu;

    html += `
      <tr>
        <td>${rotuloNum}- ${esc(it.descricao || "")}</td>
        <td class="col-un">${esc(it.unidade || "")}</td>
        <td class="col-qtd">${qtd ? num(qtd) : ""}</td>
        <td class="col-vu">${brl(vu)}</td>
        <td colspan="2" class="col-vt">${brl(vt)}</td>
      </tr>`;
  });

  html += `
        <tr class="total-linha">
          <td colspan="4" style="text-align:right;">Valor Total Estimado</td>
          <td colspan="2" class="col-vt">${brl(valorTotal || 0)}</td>
        </tr>
      </tbody>
    </table>`;

  return html;
}

/* observações dos itens (Obs: Item N - ...) listadas após o quadro */
function blocoObservacoesItens(itens){
  const obs = (itens || []).filter(i => i.observacao && i.observacao.trim());
  if(!obs.length) return "";
  return `
    <div class="obs-itens">
      ${obs.map(i => `<div class="obs">${esc(i.observacao)}</div>`).join("")}
    </div>`;
}

/* nota de rodapé sobre INSS (mesma em todos os modelos) */
function blocoNotaINSS(){
  return `<div class="nota-inss">${NOTA_INSS}</div>`;
}

/* bloco do responsável comercial (assinatura) */
function blocoComercial(responsavel){
  const r = responsavel || {};
  return `
    <div class="bloco-final">
      <div class="ass-linha">${esc(CGL_INFO.razao_social)}</div>
    </div>
    <div class="bloco-comercial">
      <div class="nome">${esc(r.nome || "—")}</div>
      <div>${esc(r.cargo || "Comercial")}</div>
      ${r.telefone ? `<div>Cel.: ${esc(r.telefone)}</div>` : ""}
      ${r.email    ? `<div>${esc(r.email)}</div>`         : ""}
      <div>${esc(CGL_INFO.site)}</div>
    </div>`;
}

/* bloco "De acordo" enxuto (sem mais o quadro de informações de NF) */
function blocoDeAcordo(){
  return `
    <div class="nf-dados">
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

/* rodapé com endereço e contatos da CGL */
function blocoRodapeEmpresa(){
  return `
    <div class="rodape-empresa">
      <b>${esc(CGL_INFO.endereco)} &nbsp;&nbsp; FONE: ${esc(CGL_INFO.telefone)}</b><br>
      E-mail: ${esc(CGL_INFO.emails)}<br>
      Site: ${esc(CGL_INFO.site)}
    </div>`;
}

/* ====================================================================
   Conteúdo específico por tipo (encargos, cláusulas, observações)
   Implementação em etapas — primeiro HÉLICE completo, depois os demais.
   ==================================================================== */

/* Encargos de Responsabilidade — tabela CONTRATANTE | CGL | Não Aplica.
   Cada item: { d: descrição, r: 'CONTRATANTE'|'CGL'|'NAO', destaque?: true,
                gatilho?: 'diesel'|'hospedagem' (flag que muda a responsabilidade) }
   Os destaques (linhas amarelas) correspondem a itens críticos do PDF.
   `flags` é o objeto orcamento — usado para alternar responsáveis dos itens com gatilho. */
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
    { d: "Alimentação dentro do canteiro de obras para colaboradores. (03 funcionários por HC)", r: "CONTRATANTE", destaque: true },
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

/* observações específicas que aparecem após o quadro de preços (Obs: Item N - ...) */
function obsItensHelice(){
  return [
    "Obs: Item 3 - Será cobrado em caso da equipe ter que ser disponibilizada para execução de treinamentos/integração que ultrapasse meio período.",
    "Obs: Item 3.1 - Contratada fornece os programas PCMSO e PPRA padrão, caso seja necessário realização de novos programas, exames médicos, clínicos e laboratoriais, serão por conta da contratante ou sendo paga a verba nesse item.",
    "Obs: Item 6 - Qualquer paralisação dos serviços por motivos que independem de nossa vontade tais como indefinição de projeto, falta de matéria prima (aço, concreto, etc.), remoção de interferências, falta de licenças (publicas ou privadas), falta de acesso ou condições do terreno, ou frentes de serviços contínuos, etc estará incluso no faturamento mínimo dia do equipamento e/ou prestação de serviço.",
    "Obs: Item 9 - Será cobrado em caso de mobilizações em áreas de acesso restrito e/ou quando houver necessidade de que a mobilização ocorra de noite devido a obra esta localizada em centro urbano."
  ];
}

/* CRITÉRIOS DE MEDIÇÃO / CONDIÇÕES DE PAGAMENTOS — texto integral do PDF.
   Itens com destaque=true são impressos em negrito + itálico no PDF original. */
function criteriosMedicaoHelice(){
  return [
    { t: "Estacas serão medidas do nível do terreno até a cota inferior da estaca." },
    { t: "O Diário de obra será utilizado para Medição." },
    { t: "O Diário de Obra será enviado em formato digital, e a Contratante disporá do prazo de 2 (dois) dias úteis, contados a partir do recebimento, para análise e eventual manifestação quanto ao seu conteúdo. Caso não haja qualquer contestação dentro desse prazo, o referido documento será considerado aceito e validado pelas partes." },
    { t: "Analisar e assinar diariamente os Diários de Obra (RDO's) da Contratada." },
    { t: "As medições terão prazo de 4 dias úteis para serem analisadas e aprovadas pela contratante. Após esse período, as mesmas serão consideradas aprovadas e originarão as respectivas notas fiscais/duplicatas." },
    { t: "Na escavação em materiais com spt acima de 35 golpes ou ponta de bits, os preços terão acréscimo de 80%." },
    { t: "A Contratada não aceitará a aplicação de retenção técnica sobre os valores das medições realizadas. Como alternativa à retenção, a Contratada disponibiliza, mediante solicitação, a apresentação de Seguro Garantia." },
    { t: "No caso da inserção das armaduras se darem com o uso de nossos equipamentos cobraremos de preço de R$ 0,75 por kg levantado." },
    { t: "CHUVA: em caso de paralisações das atividades por motivo de chuva intermitente e/ou praça de trabalho saturada, que impossibilite trânsito de equipamentos pesados, será considerado 50% do faturamento mínimo acordado para cobrir despesas da CONTRATADA." },
    { t: "Os preços se referem aos serviços prestados em jornada de trabalho no horário normal segunda à sexta-feira de 07:00 as 17:00hs. Caso seja feito horas extras o valor será de R$ 380,00 por hora (equipe)." },
    { t: "O Sinal Contratual de 30% será medido no ato da assinatura do contrato ou mobilização do equipamento. Restante, será medição quinzenal, com prazo 28 dias após a data do último dia referente ao período da medição através de boleto bancário.", destaque: true },
    { t: "O atraso no pagamento pela CONTRATANTE, acarretará a mesma, multa de 2,0% (dois por cento) ao mês, mais juros diários de 0,10% (dez centésimos) ao dia, até o pagamento." },
    { t: "Em caso de ser necessário atividades no segundo turno, será cobrado 25% adicionais sobre os valores dos serviços executados.", destaque: true },
    { t: "Nos casos de eventual demanda da CONTRATANTE por fornecimento de ajudantes-extras para limpeza de terra dos trados, considerar o custo adicional de R$ 10,00/m³ (dez reais por metro cúbico escavado), garantindo-se o mínimo de R$ 420,00 por dia por ajudante-extra disponibilizado pela CONTRATADA." },
    { t: "Nos casos em que for preciso refurar estacas, por qualquer motivo alheio à CGL (exemplos: dificuldade na inserção da armação, concreto insuficiente para finalização da estaca, concreto fora da especificação causando entupimentos, etc.), será cobrado o metro linear do refuro no mesmo valor praticado para o furo." },
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

/* CONDIÇÕES GERAIS — bloco final com cláusulas operacionais */
function condicoesGeraisHelice(){
  return [
    { t: "Caso houver necessidade de mudanças internas entre as frentes de serviços, ou a necessidade de desmontar a perfuratriz, será cobrada o período efetivamente paralisado até o reinicio dos serviços no valor de hora parada / Fat. Mínimo dia e ou Locação Diária." },
    { t: "Tendo em vista que a prestação dos serviços ocorre de forma intermitente e em diversas cidades e estados, fica estabelecido que será observada, exclusivamente, a Convenção Coletiva de Trabalho vinculada à sede da matriz da CONTRATADA, não sendo possível a aplicação ou vinculação a quaisquer outras convenções coletivas de outras localidades. Se mesmo assim a CONTRATADA for obrigada a cumprir obrigações de outras convenções, para manter o equilíbrio financeiro do contrato, esse custo será integralmente repassado à CONTRATANTE." }
  ];
}

/* CONTRATAÇÃO DOS SERVIÇOS */
function contratacaoServicosTextoComum(){
  return [
    { t: "Em caso de aceitação da proposta, por estarem justas e assim contratadas, as partes firmam o presente instrumento em 2 (duas) vias de igual teor e forma, perante duas testemunhas, para que produza seus efeitos, valendo a mesma para fazer parte integrante ao contrato definitivo para todos os fins de direito, devendo ainda ser encaminhada uma Ordem de Compra de Serviço e os dados cadastrais a seguir requeridos." }
  ];
}

/* VALIDADE DA PROPOSTA */
function validadeTextoComum(dias){
  const d = dias || 30;
  return [
    { t: `A presente proposta tem validade de ${d} (${d === 30 ? "trinta" : d}) dias, contados a partir da data de sua apresentação. Ressalta-se que, para o agendamento do início da obra, deverá ser previamente verificada a disponibilidade dos equipamentos necessários, sendo esta condicionada à confirmação no momento da contratação.` },
    { t: "Em caso de aceitação da presente proposta, solicitamos nos seja encaminhada correspondência, datada e assinada, com o seu \"DE ACORDO\", assim como nos sejam informados o número do CNPJ, o número da Inscrição Estadual e o local para cobrança." },
    { t: "Após assinatura da proposta, será providenciado o contrato." },
    { t: "Colocamo-nos ao seu inteiro dispor para quaisquer esclarecimentos adicionais." }
  ];
}

/* dispatch por tipo de proposta — passa flags do orçamento para que os encargos
   com gatilho (diesel, hospedagem) alterem a coluna marcada automaticamente */
function encargosPorTipo(tipo, flags){
  switch(tipo){
    case "helice":  return encargosHelice(flags);
    case "trado":   return []; /* TODO */
    case "raiz":    return []; /* TODO */
    case "secante": return []; /* TODO */
    default:        return [];
  }
}
function obsItensPorTipo(tipo){
  switch(tipo){
    case "helice":  return obsItensHelice();
    case "trado":   return []; /* TODO */
    case "raiz":    return []; /* TODO */
    case "secante": return []; /* TODO */
    default:        return [];
  }
}
function criteriosMedicaoPorTipo(tipo){
  switch(tipo){
    case "helice":  return criteriosMedicaoHelice();
    case "trado":   return []; /* TODO */
    case "raiz":    return []; /* TODO */
    case "secante": return []; /* TODO */
    default:        return [];
  }
}
function condicoesGeraisPorTipo(tipo){
  switch(tipo){
    case "helice":  return condicoesGeraisHelice();
    case "trado":   return []; /* TODO */
    case "raiz":    return []; /* TODO */
    case "secante": return []; /* TODO */
    default:        return [];
  }
}

/* renderiza tabela de encargos */
function blocoEncargos(encargos){
  if(!encargos || !encargos.length) return "";
  const linhaX = (it) => {
    const c = it.r === "CONTRATANTE" ? "X" : "";
    const g = it.r === "CGL"          ? "X" : "";
    const n = it.r === "NAO"          ? "X" : "";
    const cls = it.destaque ? "destaque" : "";
    return `<tr class="${cls}">
      <td>${esc(it.d)}</td>
      <td class="x">${c}</td>
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

/* renderiza lista de cláusulas (CRITÉRIOS, CONDIÇÕES GERAIS, CONTRATAÇÃO, VALIDADE) */
function blocoClausulas(titulo, itens){
  if(!itens || !itens.length) return "";
  return `
    <div class="clausulas">
      <div class="secao-titulo">${esc(titulo)}</div>
      ${itens.map(it => `<div class="item ${it.destaque ? "destaque" : ""}">${esc(it.t)}</div>`).join("")}
    </div>`;
}

/* ====================================================================
   Montagem do documento completo
   ==================================================================== */
function montarHtmlProposta(dados){
  const { orcamento, itens, cliente, responsavel } = dados;
  const tipo = orcamento.tipo_proposta || "helice";
  const tInfo = PROPOSTA_TIPOS[tipo] || PROPOSTA_TIPOS.outro;
  const codigoModelo = orcamento.codigo_modelo || tInfo.codigo;
  const revisao      = orcamento.numero_revisao || "00";

  /* combina itens reais do banco + itens virtuais gerados pelos flags
     (Diesel quando cgl_fornece_diesel; Hospedagem quando cgl_fornece_hospedagem) */
  const extras = itensVirtuais(orcamento);
  const itensQuadro = [...(itens || []), ...extras];
  const totalQuadro = itensQuadro.reduce(
    (s, it) => s + Number(it.quantidade || 0) * Number(it.valor_unitario || 0),
    0
  );

  const corpo = `
    ${blocoCabecalho(tipo, codigoModelo, revisao, 1, 1)}
    ${blocoDestinatario(cliente, orcamento.cidade_emissao, orcamento.data_orcamento)}
    ${blocoNumeroProposta(orcamento.numero, orcamento.data_orcamento, revisao)}
    ${blocoIntroducao(orcamento.referencia_obra || orcamento.descricao, tipo)}
    ${blocoCondicoesGerais(orcamento.escopo_servicos || orcamento.observacoes, orcamento.equipamento_considerado, orcamento.projeto_sondagem_fornecido)}
    ${blocoQuadroPrecos(itensQuadro, totalQuadro)}
    ${blocoNotaINSS()}
    ${blocoObservacoesItens(itens)}
    ${(obsItensPorTipo(tipo) || []).map(t => `<div class="obs-itens"><div class="obs">${esc(t)}</div></div>`).join("")}
    ${blocoEncargos(encargosPorTipo(tipo, orcamento))}
    ${blocoClausulas("CRITÉRIOS DE MEDIÇÃO / CONDIÇÕES DE PAGAMENTOS", criteriosMedicaoPorTipo(tipo))}
    ${blocoClausulas("CONDIÇÕES GERAIS", condicoesGeraisPorTipo(tipo))}
    ${blocoClausulas("CONTRATAÇÃO DOS SERVIÇOS", contratacaoServicosTextoComum())}
    ${blocoClausulas("VALIDADE DA PROPOSTA", validadeTextoComum(orcamento.validade_dias || 30))}
    ${blocoComercial(responsavel)}
    ${blocoDeAcordo()}
    ${blocoRodapeEmpresa()}
  `;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>Proposta ${esc(orcamento.numero || "")}</title>
<style>${CSS_PROPOSTA}</style>
</head><body>${corpo}</body></html>`;
}

/* ====================================================================
   Funções públicas: buscar dados, visualizar e baixar
   ==================================================================== */

/* busca tudo necessário para montar a proposta */
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
  /* fallback: se o responsável não tem dados, usa o usuário logado */
  if(!responsavel){
    const { data:{ user } } = await sb.auth.getUser();
    if(user){
      const { data:p } = await sb.from("profiles").select("*").eq("id", user.id).single();
      responsavel = p;
    }
  }

  return { orcamento: orc, itens: itens || [], cliente, responsavel };
}

/* abre a proposta como HTML em nova aba (preview rápido) */
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

/* baixa a proposta como PDF (via html2pdf.js) */
async function baixarProposta(orcamentoId){
  try {
    const dados = await carregarDadosProposta(orcamentoId);
    const html  = montarHtmlProposta(dados);
    const num   = numeroLimpo(dados.orcamento.numero) + "_" + anoDe(dados.orcamento.data_orcamento);
    const tipo  = (PROPOSTA_TIPOS[dados.orcamento.tipo_proposta] || PROPOSTA_TIPOS.outro).rotulo;
    const nomeArq = `Proposta_${tipo}_${num}.pdf`;

    /* html2pdf precisa do HTML montado num container vivo no DOM */
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const doc = wrap.querySelector("body") || wrap;

    await html2pdf().set({
      margin:      [0, 0, 0, 0],
      filename:    nomeArq,
      image:       { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak:   { mode: ["css", "legacy"] }
    }).from(doc).save();
  } catch(err){
    aviso("app-aviso", err.message || "Erro ao gerar o PDF.", "erro");
  }
}

/* ---------- Listeners (botões da ficha) ---------- */
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

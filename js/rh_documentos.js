/* ====================================================================
   Módulo: RH — documentos de admissão em PDF (fase 93a, chamado #69)

   Os cinco modelos Word com mala direta do Departamento Pessoal viram HTML
   com os campos no lugar dos MERGEFIELD e saem em PDF pelo html2pdf (mesma
   identidade dos outros PDFs do app: pdfMargens/pdfCarimbarRodape do core).
   O arquivo vai para o bucket privado rh-documentos/<funcionario_id>/ e
   ganha uma linha em funcionario_documentos (tipo admissao_*). Depois, o
   botão "Enviar para assinatura" manda o PDF à D4Sign (function d4sign-api,
   ação enviar_rh; plano básico 10 req/h, nunca polling: o status volta pelo
   d4sign-webhook).

   Modelos (texto conferido pela Jucirlene contra o Word — checklist no PR):
     admissao_ficha               RG 5.17 Cadastro para admissão de empregados (rev. 02 – 21/05/2025)
     admissao_contrato            RG 5.4  Contrato de experiência + 5.4.1 acordo de compensação +
                                          5.4.2 declaração de opção (FGTS) + 5.4.3 seguro-desemprego (rev. 01 – 20/10/2023)
     admissao_contrato_ajudante   RG 5.5  Idem, com §1º/§2º de progressão do ajudante (rev. 01 – 20/10/2023)
     admissao_prorrogacao         RG 5.6  Termo de prorrogação do contrato de experiência (rev. 01 – 20/10/2023)
     admissao_contrato_trabalho   RG 5.7  Contrato de trabalho — retorno depois de 12 meses (rev. 01 – 20/10/2023)

   Estilo inline com hex: o PDF roda fora do CSS do app (exceção da paleta,
   como propostas.js e gerarPDFMedicao). Tudo que vem do banco passa por esc().
   Prefixo dos IDs: rhd-. Depende de funcionarios.js (funcCarregarSensivel,
   funcVeSensivel, _funcs) só em tempo de execução.
   ==================================================================== */

const RHD_EMPRESA = {
  nome:       "CGL Fundações Ltda",
  nomeCaixa:  "CGL FUNDAÇÕES LTDA",
  cnpj:       "25.290.743/0001-74",
  endereco:   "Avenida Hematita, 562, Distrito Industrial, Itabira/MG",
  cep:        "35903-051",
  cidade:     "Itabira"
};
const RHD_HORARIO_PADRAO   = "de 7:00 às 17:00 (seg a quin) 7:00 às 16:00 (sex)";
const RHD_INTERVALO_PADRAO = "(uma) hora";

const RHD_MODELOS = {
  admissao_ficha:             { rg: "RG 5.17", titulo: "Cadastro para admissão de empregados", rev: "02 – 21/05/2025", rotulo: "Ficha cadastral (RG 5.17)",                 arquivo: "ficha-cadastral" },
  admissao_contrato:          { rg: "RG 5.4",  titulo: "Contrato de experiência",              rev: "01 – 20/10/2023", rotulo: "Documentos admissionais (RG 5.4)",         arquivo: "documentos-admissionais" },
  admissao_contrato_ajudante: { rg: "RG 5.5",  titulo: "Contrato de experiência",              rev: "01 – 20/10/2023", rotulo: "Documentos admissionais — ajudante/soldador (RG 5.5)", arquivo: "documentos-admissionais-ajudante" },
  admissao_prorrogacao:       { rg: "RG 5.6",  titulo: "Termo de prorrogação do contrato de experiência", rev: "01 – 20/10/2023", rotulo: "Prorrogação do contrato de experiência (RG 5.6)", arquivo: "prorrogacao-experiencia" },
  admissao_contrato_trabalho: { rg: "RG 5.7",  titulo: "Contrato de trabalho",                 rev: "01 – 20/10/2023", rotulo: "Contrato de trabalho — retorno após 12 meses (RG 5.7)", arquivo: "contrato-de-trabalho" }
};
/* contrato que a admissão pede, pelo tipo_documento */
const RHD_CONTRATO_POR_TIPO = { padrao: "admissao_contrato", ajudante_soldador: "admissao_contrato_ajudante", retorno_12_meses: "admissao_contrato_trabalho" };

/* ---------- salário por extenso (pt-BR) ----------
   rhExtenso(2464) → "Dois Mil Quatrocentos e Sessenta e Quatro Reais"; rhExtenso(1050.5) → "Mil e Cinquenta Reais e Cinquenta Centavos" */
const RHD_UNID = ["", "Um", "Dois", "Três", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove", "Dez", "Onze", "Doze", "Treze", "Quatorze", "Quinze", "Dezesseis", "Dezessete", "Dezoito", "Dezenove"];
const RHD_DEZ  = ["", "", "Vinte", "Trinta", "Quarenta", "Cinquenta", "Sessenta", "Setenta", "Oitenta", "Noventa"];
const RHD_CENT = ["", "Cento", "Duzentos", "Trezentos", "Quatrocentos", "Quinhentos", "Seiscentos", "Setecentos", "Oitocentos", "Novecentos"];
function rhdCentena(n){
  if(n === 100) return "Cem";
  const c = Math.floor(n / 100), r = n % 100, partes = [];
  if(c) partes.push(RHD_CENT[c]);
  if(r){
    if(r < 20) partes.push(RHD_UNID[r]);
    else { const d = Math.floor(r / 10), u = r % 10; partes.push(u ? RHD_DEZ[d] + " e " + RHD_UNID[u] : RHD_DEZ[d]); }
  }
  return partes.join(" e ");
}
function rhExtenso(valor){
  const v = Math.round((Number(valor) || 0) * 100);
  const reais = Math.floor(v / 100), cent = v % 100;
  if(reais === 0 && cent === 0) return "Zero Reais";
  const grupos = [["", ""], ["Mil", "Mil"], ["Milhão", "Milhões"], ["Bilhão", "Bilhões"]];
  const partes = []; let n = reais, i = 0, g0 = reais % 1000;
  while(n > 0 && i < grupos.length){
    const g = n % 1000;
    if(g){
      const texto = (i === 1 && g === 1) ? "" : rhdCentena(g);
      const nome = grupos[i][g === 1 ? 0 : 1];
      partes.unshift(((texto ? texto + " " : "") + nome).trim());
    }
    n = Math.floor(n / 1000); i++;
  }
  let txt;
  if(partes.length <= 1) txt = partes[0] || "";
  else {
    const ultimo = partes[partes.length - 1];
    const liga = (g0 > 0 && (g0 < 100 || g0 % 100 === 0)) ? " e " : " ";
    txt = partes.slice(0, -1).join(" ") + (g0 > 0 ? liga + ultimo : " " + ultimo);
  }
  let saida = "";
  if(reais > 0){
    const soMilhoes = reais >= 1e6 && reais % 1e6 === 0;
    saida = txt + (soMilhoes ? " de " : " ") + (reais === 1 ? "Real" : "Reais");
  }
  if(cent > 0) saida += (saida ? " e " : "") + rhdCentena(cent) + (cent === 1 ? " Centavo" : " Centavos");
  return saida.replace(/\s+/g, " ").trim();
}

/* ---------- utilitários de texto ---------- */
const rhdV   = (v) => (v == null || String(v).trim() === "") ? "" : String(v).trim();
const rhdOu  = (v, vazio = "________________") => rhdV(v) ? esc(rhdV(v)) : vazio;
const rhdDat = (d) => d ? dataBR(String(d).slice(0, 10)) : "____/____/______";
const rhdBRL = (v) => (v == null || v === "") ? "R$ __________" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rhdX   = (cond) => cond ? "X" : "&nbsp;&nbsp;";
function rhdDataPorExtenso(iso){
  const d = iso ? new Date(String(iso).slice(0, 10) + "T00:00:00") : new Date();
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/* ---------- cabeçalho do SGQ (todas as páginas dos modelos) ---------- */
function rhdCabecalho(titulo, rg, rev, pagina, total){
  const cel = "border:1px solid #333;padding:2px 4px;font-size:8pt;";
  return `<table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-bottom:5mm;" class="nao-quebrar">
    <tr>
      <td rowspan="4" style="${cel}width:22mm;text-align:center;vertical-align:middle;"><img src="${pdfUrl(PDF_LOGO_SRC)}" alt="CGL" style="height:16mm;width:16mm;display:block;margin:0 auto;"></td>
      <td colspan="4" style="${cel}text-align:center;font-weight:700;font-size:9pt;">Sistema de Gestão da Qualidade</td>
    </tr>
    <tr>
      <td colspan="2" style="${cel}text-align:center;font-weight:700;">TIPO DE DOCUMENTO</td>
      <td colspan="2" style="${cel}text-align:center;font-weight:700;">IDENTIFICAÇÃO</td>
    </tr>
    <tr>
      <td colspan="2" rowspan="2" style="${cel}text-align:center;font-weight:700;font-size:9pt;vertical-align:middle;">${esc(titulo)}</td>
      <td style="${cel}text-align:center;">${esc(rg)}</td>
      <td style="${cel}text-align:center;">REVISÃO<br>${esc(rev)}</td>
    </tr>
    <tr>
      <td colspan="2" style="${cel}text-align:center;">PÁGINA ${pagina} de ${total}</td>
    </tr>
  </table>`;
}
/* 10 pt justificado: o contrato de experiência (RG 5.4/5.5, 14 parágrafos + quadro do VT + assinaturas) tem de caber numa página A4 */
const RHD_P = "font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.38;color:#111;text-align:justify;margin:0 0 2.4mm;";
function rhdPagina(conteudo, primeira){
  return `<div style="${primeira ? "" : "page-break-before:always;"}font-family:Arial,Helvetica,sans-serif;color:#111;">${conteudo}</div>`;
}
/* página cheia (contrato de experiência do ajudante com os dois §, contrato de trabalho): 9,5 pt para caber como no Word */
function rhdDensa(html){
  return html.replace(/font-size:10pt;line-height:1\.38;[^"]*margin:0 0 2\.4mm;/g, "font-size:9.5pt;line-height:1.3;color:#111;text-align:justify;margin:0 0 1.9mm;");
}
function rhdAssinaturas(nomeEmpregado, comEmpresa = true, rotuloEmpregado = ""){
  const bloco = (t) => `<td style="width:50%;text-align:center;padding:14mm 4mm 0;font-size:10pt;"><div style="border-top:1px solid #111;padding-top:2mm;">${t}</div></td>`;
  return `<table style="width:100%;border-collapse:collapse;margin-top:6mm;" class="nao-quebrar"><tr>
    ${comEmpresa ? bloco(RHD_EMPRESA.nomeCaixa) : `<td style="width:50%;"></td>`}
    ${bloco((rotuloEmpregado ? rotuloEmpregado + "<br>" : "") + rhdOu(nomeEmpregado))}
  </tr></table>`;
}
function rhdTestemunhas(){
  return `<table style="width:100%;border-collapse:collapse;margin-top:8mm;font-size:9pt;" class="nao-quebrar"><tr>
    <td style="width:50%;text-align:center;padding:0 4mm;"><div style="border-top:1px solid #111;padding-top:2mm;">Testemunha 1</div></td>
    <td style="width:50%;text-align:center;padding:0 4mm;"><div style="border-top:1px solid #111;padding-top:2mm;">Testemunha 2</div></td>
  </tr></table>`;
}

/* ---------- dados para a mala direta ---------- */
function rhdCampos(d){
  const { f = {}, s = {}, a = {} } = d;
  const salario = a.salario ?? s.salario_contabil ?? null;
  return {
    nome: f.nome || "", funcao: a.funcao || f.funcao || "", data_admissao: a.data_admissao || f.data_admissao || null,
    salario, salario_extenso: salario != null ? rhExtenso(salario) : "",
    horario: s.horario_trabalho || RHD_HORARIO_PADRAO, intervalo: s.intervalo || RHD_INTERVALO_PADRAO,
    venc1: a.vencimento_1 || null, venc2: a.vencimento_2 || null, prazo: a.prazo_experiencia_dias ?? 45, prorrogacao: a.prorrogacao_dias ?? 45,
    ctps: s.ctps || "", serie: s.ctps_serie || "", pis: s.pis || "", cpf: s.cpf || "", rg: s.rg || "", rg_orgao: s.rg_orgao_emissor || "",
    nascimento: s.data_nascimento || null, mae: s.nome_mae || "", pai: s.nome_pai || "",
    logradouro: s.logradouro || "", numero: s.numero || "", complemento: s.complemento || "", bairro: s.bairro || "", cidade: s.cidade || "", uf: (s.uf || "").toUpperCase(), cep: s.cep || "",
    celular: f.telefone || "", email: f.email || "", raca_cor: s.raca_cor || "", dependentes: s.dependentes || "",
    naturalidade: s.naturalidade || "", titulo: s.titulo_eleitor || "", zona: s.zona_eleitoral || "", secao: s.secao_eleitoral || "",
    reservista: s.reservista || "", instrucao: s.grau_instrucao || "", agencia: s.agencia || "", operacao: s.operacao || "", conta: s.conta || "", banco: s.banco || "Itaú",
    cnh: f.cnh_categoria || "", tipo_contrato: f.tipo_contrato || "clt", experiencia: (a.prazo_experiencia_dias ?? 45) > 0,
    vt_opta: a.vale_transporte_opta
  };
}

/* ====================================================================
   RG 5.17 — Cadastro para admissão de empregados (ficha cadastral)
   ==================================================================== */
function rhdHtmlFicha(c){
  const m = RHD_MODELOS.admissao_ficha;
  const td = "border:1px solid #333;padding:2px 5px;font-size:9.5pt;vertical-align:top;";
  const rot = `<span style="font-size:7.5pt;color:#444;display:block;">`;
  const cel = (rotulo, valor, extra = "") => `<td style="${td}${extra}">${rot}${rotulo}</span>${valor || "&nbsp;"}</td>`;
  const chk = (t) => `<td style="${td}width:50%;">☐ ${t}</td>`;
  const corpo = `
    ${rhdCabecalho(m.titulo.toUpperCase(), m.rg, m.rev, 1, 1)}
    <p style="${RHD_P}text-align:center;font-weight:700;font-size:11pt;">DADOS PARA ADMISSÃO CGL FUNDAÇÕES</p>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
      <tr>${cel("Empregado:", rhdOu(c.nome, ""), "width:70%;")}${cel("Data de admissão:", rhdDat(c.data_admissao))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>
        ${cel("Função:", rhdOu(c.funcao, ""), "width:34%;")}
        ${cel("Tipo de contrato:", `PJ (${rhdX(c.tipo_contrato === "pj")}) &nbsp; Estagio (${rhdX(c.tipo_contrato === "estagiario")}) &nbsp; CLT (${rhdX(c.tipo_contrato === "clt")})`, "width:30%;")}
        ${cel("Salário:", rhdBRL(c.salario), "width:18%;")}
        ${cel("Contrato de experiência:", c.experiencia ? "SIM" : "NÃO")}
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("Uniforme/ EPI´s:", "", "width:22%;")}${cel("Nº calça", "")}${cel("Nº camisa", "")}${cel("Nº botina", "")}${cel("Outros:", "", "width:30%;")}</tr>
    </table>
    <p style="${RHD_P}text-align:center;font-weight:700;margin-top:4mm;">DADOS PESSOAIS</p>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
      <tr>${cel("Nome da mãe:", rhdOu(c.mae, ""), "width:50%;")}${cel("Nome do pai:", rhdOu(c.pai, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("Endereço:", esc([c.logradouro, c.numero, c.complemento].filter(Boolean).join(" ")), "width:65%;")}${cel("Bairro:", rhdOu(c.bairro, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("Cidade:", esc([c.cidade, c.uf].filter(Boolean).join(" / ")), "width:45%;")}${cel("CEP:", rhdOu(c.cep, ""), "width:20%;")}${cel("Fone:", rhdOu(c.celular, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("Data de Nascimento:", rhdDat(c.nascimento), "width:30%;")}${cel("Características Físicas:", rhdOu(c.raca_cor, ""), "width:40%;")}${cel("Dependentes:", rhdOu(c.dependentes, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("E-mail:", rhdOu(c.email, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("RG:", esc([c.rg, c.rg_orgao].filter(Boolean).join(" ")), "width:26%;")}${cel("Naturalidade:", rhdOu(c.naturalidade, ""), "width:26%;")}${cel("Tít. Eleitor:", rhdOu(c.titulo, ""), "width:24%;")}${cel("Zona:", rhdOu(c.zona, ""))}${cel("Seção", rhdOu(c.secao, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("PIS:", rhdOu(c.pis, ""), "width:22%;")}${cel("CPF:", rhdOu(c.cpf, ""), "width:22%;")}${cel("CTPS:", rhdOu(c.ctps, ""), "width:20%;")}${cel("Série:", rhdOu(c.serie, ""), "width:18%;")}${cel("CNH:", rhdOu(c.cnh, ""))}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin-top:-1px;">
      <tr>${cel("Certificado Reservista:", rhdOu(c.reservista, ""), "width:30%;")}${cel("Escolaridade:", rhdOu(c.instrucao, ""), "width:30%;")}${cel("Dados Bancários:", esc([c.agencia && "Ag. " + c.agencia, c.operacao && "Op. " + c.operacao, c.conta && "Conta " + c.conta, c.banco].filter(Boolean).join(" ")))}</tr>
    </table>
    <p style="${RHD_P}text-align:center;font-weight:700;margin-top:4mm;">CHEK LIST COMPLEMENTAR</p>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">
      <tr>${chk("Cadastro no e-Social")}${chk("Criação login de acesso")}</tr>
      <tr>${chk("Benefícios: VT; VR; Plano de Saúde")}${chk("Criação e-mail Corporativo")}</tr>
      <tr>${chk("Local de trabalho Organizado (computador e mesa)")}${chk("Acesso aos sistemas e pastas")}</tr>
    </table>
    <p style="${RHD_P}margin-top:5mm;font-size:9.5pt;">Declaro que estou ciente, que meus dados pessoais serão armazenados no banco de dados da empresa, de forma sigilosa, conforme prevê a Lei de proteção de dados (LGPD).</p>
    <p style="${RHD_P}font-size:9.5pt;">Os dados coletados serão utilizados e armazenados durante o tempo necessário para a prestação do serviço ou para que as finalidades elencadas na presente Política de Privacidade sejam atingidas.</p>
    <p style="${RHD_P}font-size:9.5pt;">De modo geral, seus dados serão mantidos enquanto a relação contratual entre você e a empresa perdurar. Findado o período de armazenamento dos dados pessoais, estes serões excluídos de nossas bases de dados ou anonimizados.</p>
    <p style="${RHD_P}margin-top:6mm;">Ciente em &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Assinatura: ________________________________________</p>`;
  return rhdPagina(corpo, true);
}

/* ====================================================================
   RG 5.4 / RG 5.5 — Documentos admissionais (4 páginas)
   ==================================================================== */
function rhdHtmlContratoExperiencia(c, tipo){
  const ajudante = tipo === "admissao_contrato_ajudante";
  const m = RHD_MODELOS[tipo];
  const base = ajudante ? "RG 5.5" : "RG 5.4";
  const E = RHD_EMPRESA;
  const sub = (n) => `${base}.${n}`;
  const clausulaAjudante = ajudante ? `
    <p style="${RHD_P}">§ 1°- Permanecendo na mesma função pelo período de 2(dois) anos será garantida uma gratificação de 15% (quinze por cento) sobre o salário, passando a ser denominado Ajudante de Equipamento II.</p>
    <p style="${RHD_P}">§ 2º - Permanecendo na mesma função de Ajudante de Equipamento II pelo período de 3(três) anos será garantida uma gratificação de 15% (quinze por cento) sobre o salário, passando a ser denominado Ajudante de Equipamento III.</p>` : "";
  const pag1 = `
    ${rhdCabecalho("CONTRATO DE EXPERIÊNCIA", base, m.rev, 1, 4)}
    <p style="${RHD_P}">Por este instrumento particular, que entre si fazem a empresa, ${E.nomeCaixa} – CNPJ:${E.cnpj} com sede na Avenida Hematita, 562, Distrito Industrial, Itabira, CEP ${E.cep}, neste ato denominado (a) EMPREGADOR (A), e o (a) Sr &nbsp;${rhdOu(c.nome)} portador(a) da Carteira de Trabalho nº ${rhdOu(c.ctps)}. Série ${rhdOu(c.serie)}, PIS/PASEP nº. ${rhdOu(c.pis)}, doravante chamado simplesmente EMPREGADO e firmam o presente contrato individual de trabalho, em caráter de experiência, conforme a letra C parágrafo 2º do Artigo 443 da Consolidação das Leis do Trabalho, mediante as seguintes condições:</p>
    <p style="${RHD_P}">O empregado trabalhará para a empregadora, exercendo a função de ${rhdOu(c.funcao)}, percebendo como salário a quantia de &nbsp;${rhdBRL(c.salario)}(${rhdOu(c.salario_extenso)}) por mês.</p>
    ${clausulaAjudante}
    <p style="${RHD_P}">O horário a ser obedecido será o seguinte: ${esc(c.horario)}, com ${esc(c.intervalo)} de intervalo para repouso e alimentação.</p>
    <p style="${RHD_P}">Este contrato tem início a partir ${rhdDat(c.data_admissao)} vencendo em ${rhdDat(c.venc1)}, podendo ser prorrogado, obedecido ao disposto no Parágrafo Único do Artigo 445 da CLT.</p>
    <p style="${RHD_P}">O empregado se compromete a trabalhar em regime de compensação e prorrogação de horas, inclusive em período noturno, sempre que as necessidades assim o exigirem, observadas as formalidades legais.</p>
    <p style="${RHD_P}">Obriga-se o Empregado, além de executar com dedicação e lealdade o seu serviço, a cumprir o Regulamento Interno da Empregadora, as instruções de sua administração e as ordens de seus chefes e superiores hierárquicos, relativas às peculiaridades dos Serviços que lhe forem confiados, podendo ser transferido para qualquer local, inclusive em outros municípios.</p>
    <p style="${RHD_P}">Aplicam-se a este contrato todas as normas em vigor, relativas aos contratos a prazo determinado, (art. 479), devendo sua rescisão antecipada, pôr justa causa, obedecer ao disposto nos artigos 482 e 483 da CLT, conforme o caso.</p>
    <p style="${RHD_P}">Além dos descontos previstos em lei, a Empregadora reserva-se o direito de descontar do empregado (a) as importâncias correspondentes a danos pôr ele causados.</p>
    <p style="${RHD_P}">Vencido o período experimental e continuando o Empregado a prestar serviços à Empregadora, pôr tempo indeterminado, ficam prorrogadas todas as cláusulas aqui estabelecidas, enquanto não se rescindir o contrato de trabalho.</p>
    <p style="${RHD_P}">Para abono de faltas fica estipulado o prazo máximo de 72 horas, para entrega do atestado médico, no departamento Pessoal, podendo assim a empresa se recusar de aceitar após esse prazo.</p>
    <p style="${RHD_P}">Em se tratando de vale transporte o empregado:</p>
    <table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;margin:0 0 3mm;" class="nao-quebrar">
      <tr><td style="width:8mm;border:1px solid #333;text-align:center;font-weight:700;">${rhdX(c.vt_opta === false)}</td><td style="padding:1mm 3mm;">Não pretende utilizar o benefício do vale transporte, dessa forma não requer o fornecimento do mesmo.</td></tr>
      <tr><td style="height:3mm;"></td><td></td></tr>
      <tr><td style="width:8mm;border:1px solid #333;text-align:center;font-weight:700;">${rhdX(c.vt_opta === true)}</td><td style="padding:1mm 3mm;">Pretende utilizar o benefício do vale transporte e dessa forma requer o fornecimento do mesmo, permitindo o desconto de 6% de seu salário.</td></tr>
    </table>
    <p style="${RHD_P}">E por estarem em pleno acordo, assinam ambas as partes, em duas vias de igual teor.</p>
    <p style="${RHD_P}">${E.cidade}, ${rhdDataPorExtenso(c.data_admissao)}</p>
    ${rhdAssinaturas(c.nome)}`;
  const pag2 = `
    ${rhdCabecalho("ACORDO COMPENSAÇÃO DE HORAS", sub(1), m.rev, 2, 4)}
    <p style="${RHD_P}">Pelo presente Acordo de Trabalho, celebrado entre a ${E.nome}, CNPJ ${E.cnpj}, situada a Avenida Hematita, 562, Distrito Industrial, Itabira /MG; e seu empregado ${rhdOu(c.nome)} função ${rhdOu(c.funcao)}, fica estipulado o seguinte:</p>
    <p style="${RHD_P}">Que o horário de trabalho será prorrogado por mais minutos de trabalho, a título de compensação, em consequência ficará dispensado ou terá seu horário de trabalho diminuído.</p>
    <p style="${RHD_P}">Que o presente acordo poderá ser rescindido entre as partes, mediante simples notificação por escrito da parte interessada, passando a prevalecer o horário normal, aos sábados;</p>
    <p style="${RHD_P}">O horário de trabalho, em face de compensação de presente acordo é o seguinte.</p>
    <p style="${RHD_P}margin-left:8mm;">Segunda-feira: 07:00 ás 17:00 com 60 minutos para refeição e descanso<br>
      Terça-feira: 07:00 ás 17:00 com 60 minutos para refeição e descanso<br>
      Quarta-feira: 07:00 ás 17:00 com 60 minutos para refeição e descanso<br>
      Quinta-feira: 07:00 ás 17:00 com 60 minutos para refeição e descanso<br>
      Sexta-feira: 07:00 ás 16:00 com 60 minutos para refeição e descanso<br>
      Sábado e domingo: &nbsp;não trabalha</p>
    <p style="${RHD_P}">O presente acordo vigorará por tempo indeterminado</p>
    <p style="${RHD_P}">E por estarem ambas as partes assim acordadas, firmam o presente em duas vias de igual teor e para os mesmos fins, perante duas testemunhas.</p>
    <p style="${RHD_P}">${E.cidade}, ${rhdDataPorExtenso(c.data_admissao)}</p>
    ${rhdAssinaturas(c.nome)}
    ${rhdTestemunhas()}`;
  const pag3 = `
    ${rhdCabecalho("DECLARAÇÃO DE OPÇÃO", sub(2), m.rev, 3, 4)}
    <p style="${RHD_P}">Eu, ${rhdOu(c.nome)}, portador da Carteira Profissional nº. ${rhdOu(c.ctps)} Série ${rhdOu(c.serie)}, empregado da empresa ${E.nome}, situada Avenida Hematita, 562, Distrito Industrial, Itabira / MG, declaro, para todos os fins, que nesta data, exerço a opção pelo regime do regulamento do Fundo de Garantia do Tempo de Serviço.</p>
    <p style="${RHD_P}">${E.cidade}, ${rhdDataPorExtenso(c.data_admissao)}</p>
    <p style="${RHD_P}">Empregado:</p>
    ${rhdAssinaturas(c.nome, false)}`;
  const pag4 = `
    ${rhdCabecalho("DECLARAÇÃO SEGURO-DESEMPREGO", sub(3), m.rev, 4, 4)}
    ${rhdTabelaPartes(c)}
    <p style="${RHD_P}">Declaro sob as penas da lei, que não estou recebendo o seguro desemprego que trata o Decreto-Lei n.º 2.284 de 10/03/1986, regulamento pelo decreto n.º 92.608 de 02/05/1986, que estou ciente que o recebimento do benefício após a admissão nesta empresa é crime e está sujeito a ser punido civil e criminalmente. Desde já assumo o compromisso de restituir a empresa a 3ª via de Comunicação de Dispensa – CD, recebido no emprego anterior.</p>
    <p style="${RHD_P}">Por ser a expressão da verdade a presente declaração na forma da Lei, presença de 2 (duas) testemunhas.</p>
    <p style="${RHD_P}">${E.cidade}, ${rhdDataPorExtenso(c.data_admissao)}</p>
    <p style="${RHD_P}">Empregado:</p>
    ${rhdAssinaturas(c.nome, false)}
    ${rhdTestemunhas()}`;
  return rhdPagina(ajudante ? rhdDensa(pag1) : pag1, true) + rhdPagina(pag2) + rhdPagina(pag3) + rhdPagina(pag4);
}
/* quadro Empresa / CNPJ / Endereço / Empregado / Cargo (RG 5.4.3, 5.5.3 e 5.6) */
function rhdTabelaPartes(c, comCtps){
  const E = RHD_EMPRESA;
  const td = "border:1px solid #333;padding:2px 5px;font-size:10pt;vertical-align:top;";
  const rot = `<span style="font-size:7.5pt;color:#444;display:block;">`;
  return `<table style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin:0 0 4mm;" class="nao-quebrar">
    <tr><td style="${td}width:60%;">${rot}Empresa:</span>${E.nome}</td><td style="${td}">${rot}CNPJ:</span>${E.cnpj}</td></tr>
    <tr><td colspan="2" style="${td}">${rot}Endereço:</span>Avenida Hematita, 562 – Distrito Industrial I, CEP:${E.cep} ITABIRA/MG</td></tr>
    <tr><td style="${td}">${rot}Empregado:</span>${rhdOu(c.nome, "")}</td><td style="${td}">${rot}${comCtps ? "CTPS:" : "Cargo:"}</span>${comCtps ? esc([c.ctps, c.serie].filter(Boolean).join("/")) : rhdOu(c.funcao, "")}</td></tr>
    ${comCtps ? `<tr><td colspan="2" style="${td}">${rot}Cargo:</span>${rhdOu(c.funcao, "")}</td></tr>` : ""}
  </table>`;
}

/* ====================================================================
   RG 5.6 — Termo de prorrogação do contrato de experiência
   ==================================================================== */
function rhdHtmlProrrogacao(c){
  const m = RHD_MODELOS.admissao_prorrogacao, E = RHD_EMPRESA;
  const corpo = `
    ${rhdCabecalho("TERMO DE PRORROGAÇÃO DO CONTRATO DE EXPERIÊNCIA", m.rg, m.rev, 1, 1)}
    <p style="${RHD_P}">O presente TERMO DE PRORROGAÇÃO DE CONTRATO, celebrado entre a:</p>
    ${rhdTabelaPartes(c, true)}
    <p style="${RHD_P}">Que entre si fazem, ${E.nome}., empresa de construção civil, sediada na Avenida Hematita, 562, Distrito Industrial I, Itabira/MG, inscrita no CNPJ. N.º ${E.cnpj} mediante as seguintes cláusulas e condições:</p>
    <p style="${RHD_P}">II – Este contrato teve início a partir de ${rhdDat(c.data_admissao)}, vencendo em ${rhdDat(c.venc1)}, portanto ${c.prazo} (${esc(rhExtenso(c.prazo).replace(/ Reais?$/, ""))}) dias, podendo ser prorrogado, obedecido o disposto no parágrafo único do artigo 445 da CLT.</p>
    <p style="${RHD_P}">III – Fica prorrogado o Contrato de Experiência anteriormente firmado por mais ${c.prorrogacao} (${esc(rhExtenso(c.prorrogacao).replace(/ Reais?$/, ""))}) dias, vindo, portanto a expirar em ${rhdDat(c.venc2)}.</p>
    <p style="${RHD_P}">IIII – Assim sendo, por ser esta a real vontade das partes, firmam o presente em duas vias de igual teor, para que surtam os direitos jurídicos legais, perante duas testemunhas.</p>
    <p style="${RHD_P}margin-top:6mm;">${E.cidade}, ____/____/_____.</p>
    ${rhdAssinaturas(c.nome)}
    ${rhdTestemunhas()}`;
  return rhdPagina(corpo, true);
}

/* ====================================================================
   RG 5.7 — Contrato de trabalho (retorno depois de 12 meses)
   ==================================================================== */
function rhdHtmlContratoTrabalho(c){
  const m = RHD_MODELOS.admissao_contrato_trabalho, E = RHD_EMPRESA;
  const corpo = `
    ${rhdCabecalho("CONTRATO DE TRABALHO", m.rg, m.rev, 1, 1)}
    <p style="${RHD_P}">Por este instrumento particular, que entre si fazem a empresa ${E.nome.replace("Ltda", "LTDA")}, com sede à Avenida Hematita, 562, bairro Distrito Industrial, no município de Itabira, inscrito (a) no CNPJ sob o Nº ${E.cnpj}, neste ato denominada simplesmente EMPREGADORA e o Sr.${rhdOu(c.nome)}, portador(a) da Carteira de Trabalho nº ${rhdOu(c.ctps)} Série ${rhdOu(c.serie)} PIS/PASEP nº. ${rhdOu(c.pis)} doravante chamado EMPREGADO, fica justo e acertado o presente contrato individual de trabalho, regido pelas seguintes clausulas:</p>
    <p style="${RHD_P}">CLAUSULA 1ª – O encerramento deste contrato não poderá se arquido como fator obstativo á aquisição ou manutenção de qualquer direito trabalhista, inclusive salário/auxílio maternidade, por haver sido previsto, á data de sua celebração, o seu caráter temporário e seu término normal.</p>
    <p style="${RHD_P}">CLAUSULA 2ª – O empregado trabalhará na função de ${rhdOu(c.funcao)} e demais atribuições que lhe forem correlatadas ou que com ela sua disponibilidade para realizar eventuais viagens em território Nacional, em decorrência das necessidades dos serviços. Compromete-se, ainda, ao fiel comprimento das ordens de serviço, verbais e/ou escritas que lhe forem dadas.</p>
    <p style="${RHD_P}">CLAUSULA 3ª – O empregado Receberá o salário inicial de ${rhdBRL(c.salario)} (${rhdOu(c.salario_extenso)}) por mês, pagável mensalmente e autoriza a Empregadora a depositar a organização bancaria de sua escolha, salários e quaisquer outros vencimentos que se refiram à sua remuneração.</p>
    <p style="${RHD_P}">§ 1°- Permanecendo na mesma função pelo período de 2(dois) anos será garantida uma gratificação de 15% (quinze por cento) sobre o salário, passando a ser denominado Ajudante de Equipamento II.</p>
    <p style="${RHD_P}">§ 2º - Permanecendo na mesma função de Ajudante de Equipamento II pelo período de 3(três) anos será garantida uma gratificação de 15% (quinze por cento) sobre o salário, passando a ser denominado Ajudante de Equipamento III.</p>
    <p style="${RHD_P}">CLAUSULA 4ª – A Empregadora fica autorizada a descontar da remuneração ou de quaisquer outros direitos trabalhistas do empregado, as contribuições legais e/ou convencionadas, os eventuais adiantamentos e empréstimos concedidos, outros valores devidamente autorizados e também qualquer prejuízo ou dano causado ao seu patrimônio, por culpa ou dolo, inclusive os advindos de extravio, perda ou quebra de equipamentos e ferramentas de trabalho, uniformes, vestimentas, equipamentos de proteção individual ou outros materiais de qualquer natureza posto sob sua responsabilidade.</p>
    <p style="${RHD_P}">CLAUSULA 5ª – O horário de trabalho a ser cumprido pelo empregado será de 2ª a 5ª(Segunda à Quinta)-Feira de 07:00 ás 17:00 horas e 6º(Sexta) às 07:00 à 16:00 horas, com intervalo de 60 minutos para refeição e descanso. Podendo ser alterado a critério da EMPREGADORA, inclusive de jornada diurna para nortuna e vice-versa ou em horário misto e, quando necessário em regime de revezamento, prorrogação, compensação e horário extraordinário. A Empregadora cabe a faculdade de iniciar e alterar os períodos durante a jornada.</p>
    <p style="${RHD_P}">CLAUSULA 6ª – O empregado concorda em cumprir jornada de trabalho, em dias a serem determinadas pela Empregadora e na forma por ela estabelecida, para fins de compensações de folgas, eventuais já estabelecidas ou futuras.</p>
    <p style="${RHD_P}">CLAUSULA 7ª – O empregado gozará de proteção trabalhista, previdenciária e securitária e se obriga a respeitar os regulamentos internos de trabalho, defendendo os interesses da Empregadora, agindo com correção, dedicação, lealdade e solicitude, não só com seus superiores e hierárquicos, como também com colegas de trabalho, terceiros e todos que em decorrência destes com ele mantiverem contato.</p>
    <p style="${RHD_P}">CLAUSULA 8ª – O empregado concorda expressamente para todos os fins e efeitos legais, notadamente o artigo 4169 e seus parágrafos da CLT, em ser transferido desde para outro estabelecimento da Empregadora, situado nesta ou qualquer outra praça ou unidade da federação, independente de vantagens ou remunerações expressas neste contrato.</p>
    <p style="${RHD_P}">CLAUSULA 9ª – As invenções decorrentes das atribuições do empregado originadas de pesquisa pura e aplicadas, bem como aquela oriunda de estudos efetuados com utilização das instalações e equipamentos do local de trabalho, são de prioridade exclusiva da Empregadora.</p>
    <p style="${RHD_P}">CLAUSULA 10ª – Enquanto perdurar o presente contrato, poderão ser feitas modificações de salários, funções, cargos, horários á adaptação ao emprego, conforme suas características individuais, desde que não resultem em prejuízos ao Empregado.</p>
    <p style="${RHD_P}">E por estarem justos e contratados, o Empregado e o representante legal da empregadora, firmam o presente instrumento em 02 (duas) vias de igual forma e teor para um só efeito legal, na presença das testemunhas abaixo.</p>
    <p style="${RHD_P}">${E.cidade}, ${rhdDataPorExtenso(c.data_admissao)}</p>
    ${rhdAssinaturas(c.nome)}
    ${rhdTestemunhas()}`;
  return rhdPagina(rhdDensa(corpo), true);
}

function rhdHtml(tipo, dados){
  const c = rhdCampos(dados);
  switch(tipo){
    case "admissao_ficha":             return rhdHtmlFicha(c);
    case "admissao_contrato":
    case "admissao_contrato_ajudante": return rhdHtmlContratoExperiencia(c, tipo);
    case "admissao_prorrogacao":       return rhdHtmlProrrogacao(c);
    case "admissao_contrato_trabalho": return rhdHtmlContratoTrabalho(c);
    default: throw new Error("Modelo desconhecido: " + tipo);
  }
}

/* ---------- PDF em memória (Blob), mesma identidade do pdfGerar do core ---------- */
async function rhdPdfBlob(html){
  if(typeof html2pdf === "undefined") throw new Error("Biblioteca html2pdf não carregada.");
  const { margem, largPx } = pdfMargens(190, 12);
  await pdfCarregarImagem(PDF_LOGO_SRC).catch(() => null);
  const selo = await pdfCarregarImagem(PDF_SELO_SRC, 300).catch(() => null);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const pdf = await html2pdf().set({
    margin:     margem,
    image:      { type: "jpeg", quality: 0.95 },
    html2canvas:{ scale: 2, useCORS: true, letterRendering: false, width: largPx },
    jsPDF:      { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak:  { mode: ["css", "legacy"], avoid: ["tr", "p", "li", ".nao-quebrar"] }
  }).from(wrap).toPdf().get("pdf");
  pdfCarimbarRodape(pdf, selo, margem);
  return pdf.output("blob");
}

/* ---------- dados do funcionário para a mala direta ---------- */
async function rhdAdmissaoAtual(funcionarioId){
  const { data, error } = await sb.from("admissoes").select("*").eq("funcionario_id", funcionarioId)
    .order("data_admissao", { ascending: false }).limit(1);
  if(error){ console.warn("admissões:", error.message); return null; }
  return data?.[0] || null;
}
async function rhdDados(funcionarioId, admissaoId){
  const { data: f, error } = await sb.from("funcionarios").select("*").eq("id", funcionarioId).single();
  if(error) throw new Error("Funcionário não encontrado: " + error.message);
  const s = (typeof funcCarregarSensivel === "function" ? await funcCarregarSensivel(funcionarioId) : null) || {};
  let a = null;
  if(admissaoId){ const r = await sb.from("admissoes").select("*").eq("id", admissaoId).maybeSingle(); a = r.data || null; }
  if(!a) a = await rhdAdmissaoAtual(funcionarioId);
  return { f, s, a: a || {} };
}

/* ---------- gerar, guardar e registrar ---------- */
let _rhdDocs = [];          // funcionario_documentos (tipo admissao_*) do funcionário aberto
let _rhdAdm  = null;        // última admissão do funcionário aberto
let _rhdFuncId = null;
let _rhdAlvo = null;        // documento do modal da D4Sign

function rhdNomeArquivo(tipo, nome){
  const m = RHD_MODELOS[tipo];
  const slug = String(nome || "funcionario").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${m.arquivo}_${slug}_${hojeISO()}.pdf`;
}

async function rhdGerar(tipo, funcionarioId, admissaoId){
  const dados = await rhdDados(funcionarioId, admissaoId);
  const m = RHD_MODELOS[tipo];
  const html = rhdHtml(tipo, dados);
  const blob = await rhdPdfBlob(html);
  // regra de upload do projeto: MIME pela extensão e corpo reembalado em Blob
  const corpo = new Blob([blob], { type: "application/pdf" });
  const path = `${funcionarioId}/${tipo}_${Date.now()}.pdf`;
  const { error: upErr } = await sb.storage.from("rh-documentos").upload(path, corpo, { contentType: "application/pdf", upsert: false });
  if(upErr) throw new Error("Upload do PDF falhou: " + upErr.message);
  const reg = {
    funcionario_id: funcionarioId, tipo, descricao: m.rotulo, emissao: hojeISO(),
    storage_path: path, admissao_id: dados.a?.id || null, gerado_em: new Date().toISOString(),
    gerado_por: usuarioAtual?.id || null,
    observacoes: `Gerado pelo app em ${dataBR(hojeISO())} a partir de ${m.rg} (rev. ${m.rev}).`
  };
  const { data, error } = await sb.from("funcionario_documentos").insert(reg).select().single();
  if(error){
    await sb.storage.from("rh-documentos").remove([path]).catch(() => null);
    throw new Error("PDF gerado, mas a linha do documento não foi gravada: " + error.message);
  }
  if(dados.a?.id && tipo !== "admissao_prorrogacao" && dados.a.status === "rascunho"){
    await sb.from("admissoes").update({ status: "documentos_gerados" }).eq("id", dados.a.id);
  }
  return data;
}

/* todos os da admissão: ficha + o contrato que o tipo_documento pede */
async function rhdGerarAdmissao(funcionarioId, admissao){
  const tipos = ["admissao_ficha", RHD_CONTRATO_POR_TIPO[admissao?.tipo_documento] || "admissao_contrato"];
  const feitos = [];
  for(const t of tipos) feitos.push(await rhdGerar(t, funcionarioId, admissao?.id));
  return feitos;
}

async function rhdBaixar(path, nome){
  const { data, error } = await sb.storage.from("rh-documentos").createSignedUrl(path, 300, { download: nome || true });
  if(error || !data?.signedUrl){ aviso("app-aviso", "Não foi possível abrir o PDF: " + (error?.message || "sem URL"), "erro"); return; }
  const a = document.createElement("a"); a.href = data.signedUrl; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

async function rhdExcluir(doc){
  if(!confirm(`Excluir "${doc.descricao || doc.tipo}"? O PDF sai do arquivo do funcionário.`)) return;
  if(doc.storage_path) await sb.storage.from("rh-documentos").remove([doc.storage_path]).catch(() => null);
  if(doc.arquivo_assinado_path) await sb.storage.from("rh-documentos").remove([doc.arquivo_assinado_path]).catch(() => null);
  const { error } = await sb.from("funcionario_documentos").delete().eq("id", doc.id);
  if(error){ aviso("app-aviso", "Erro ao excluir: " + error.message, "erro"); return; }
  await rhdCarregar(_rhdFuncId);
  if(typeof carregarDocsFuncionario === "function") carregarDocsFuncionario();
}

/* ---------- bloco na aba Documentos da ficha ---------- */
function rhdTagAssinatura(st){
  if(typeof tagAssinatura === "function") return tagAssinatura(st || "nao_iniciada");
  return `<span class="tag cinza">${esc(st || "nao_iniciada")}</span>`;
}
const RHD_ADM_STATUS = { rascunho: ["cinza", "Rascunho"], documentos_gerados: ["ambar", "Documentos gerados"], concluida: ["verde", "Concluída"] };
const RHD_TIPO_DOC_LBL = { padrao: "Contrato padrão (RG 5.4)", ajudante_soldador: "Ajudante/soldador (RG 5.5)", retorno_12_meses: "Retorno após 12 meses (RG 5.7)" };

async function rhdCarregar(funcionarioId){
  const cont = $("func-rh-docs");
  if(!cont) return;
  _rhdFuncId = funcionarioId || null;
  if(!_rhdFuncId || typeof funcVeSensivel !== "function" || !funcVeSensivel()){ cont.innerHTML = ""; return; }
  const [adm, docs] = await Promise.all([
    rhdAdmissaoAtual(_rhdFuncId),
    // tipo é enum: filtra pela lista (like exigiria cast no banco)
    sb.from("funcionario_documentos").select("*").eq("funcionario_id", _rhdFuncId).in("tipo", Object.keys(RHD_MODELOS)).order("gerado_em", { ascending: false })
  ]);
  _rhdAdm = adm;
  _rhdDocs = docs.error ? [] : (docs.data || []);
  rhdRender();
}

function rhdRender(){
  const cont = $("func-rh-docs");
  if(!cont) return;
  const a = _rhdAdm;
  const st = a ? (RHD_ADM_STATUS[a.status] || ["cinza", a.status]) : null;
  const resumo = a
    ? `<p class="meta">Admissão em <strong>${dataBR(a.data_admissao)}</strong> · ${esc(a.funcao)} · experiência ${a.prazo_experiencia_dias} + ${a.prorrogacao_dias} dias (1º vencimento ${dataBR(a.vencimento_1) || "—"}, 2º ${dataBR(a.vencimento_2) || "—"}) · ${esc(RHD_TIPO_DOC_LBL[a.tipo_documento] || a.tipo_documento)} <span class="tag ${st[0]}">${esc(st[1])}</span>${a.status !== "concluida" ? ` <button type="button" class="btn-sec btn-sm" id="btn-rhd-concluir">Concluir admissão</button>` : ""}</p>`
    : `<p class="meta">Sem admissão registrada no app. Use <strong>Admitir</strong> no painel (ou gere a ficha com os dados do cadastro: os campos do contrato saem em branco).</p>`;
  const opcoes = Object.entries(RHD_MODELOS).map(([k, m]) => `<option value="${k}">${esc(m.rotulo)}</option>`).join("");
  const linhas = _rhdDocs.map(d => `<tr>
      <td><strong>${esc(d.descricao || RHD_MODELOS[d.tipo]?.rotulo || d.tipo)}</strong><div class="meta">${esc(RHD_MODELOS[d.tipo]?.rg || "")}</div></td>
      <td>${d.gerado_em ? dataHoraBR(d.gerado_em) : dataBR(d.emissao) || "—"}</td>
      <td>${rhdTagAssinatura(d.assinatura_status)}${d.data_envio_assinatura ? `<div class="meta">enviado ${dataBR(d.data_envio_assinatura.slice(0, 10))}${Array.isArray(d.assinatura_signatarios) ? " para " + esc(d.assinatura_signatarios.map(s => s.email).join(", ")) : ""}</div>` : ""}${d.assinado_em ? `<div class="meta">assinado ${dataBR(d.assinado_em.slice(0, 10))}</div>` : ""}</td>
      <td style="white-space:nowrap;">
        ${d.storage_path ? `<button type="button" class="btn-sec btn-sm rhd-baixar" data-id="${esc(d.id)}">⬇️ PDF</button>` : ""}
        ${d.arquivo_assinado_path ? `<button type="button" class="btn-sec btn-sm rhd-baixar-assinado" data-id="${esc(d.id)}">✓ Assinado</button>` : ""}
        ${d.storage_path && ["nao_iniciada", "cancelada"].includes(d.assinatura_status || "nao_iniciada") ? `<button type="button" class="btn-sec btn-sm rhd-assinar" data-id="${esc(d.id)}">✍️ Enviar para assinatura</button>` : ""}
        ${["enviada", "parcial"].includes(d.assinatura_status) ? `<button type="button" class="btn-sec btn-sm rhd-status" data-id="${esc(d.id)}" title="Consulta manual — gasta 1 requisição da cota">🔄 Atualizar status</button>` : ""}
        ${!ehSomenteLeitura() ? `<button type="button" class="btn-sec btn-sm rhd-excluir" data-id="${esc(d.id)}" style="color:var(--perigo);">Excluir</button>` : ""}
      </td>
    </tr>`).join("");
  cont.innerHTML = `<div class="lista-topo compacta">
      <h3>Documentos de admissão (PDF) <span class="contador">${_rhdDocs.length}</span></h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <select id="rhd-modelo">${opcoes}</select>
        <button type="button" class="btn-sec btn-sm" id="btn-rhd-previa" title="Abre o texto em HTML numa aba, para conferir contra o Word">👁️ Prévia</button>
        <button type="button" class="btn-sec btn-sm" id="btn-rhd-gerar">📄 Gerar PDF</button>
        <button type="button" class="btn btn-sm" id="btn-rhd-gerar-admissao" ${a ? "" : "disabled"} title="Ficha cadastral + o contrato que o tipo da admissão pede">📄 Gerar os da admissão</button>
      </div>
    </div>
    ${resumo}
    <div id="rhd-aviso" class="aviso"></div>
    ${_rhdDocs.length ? `<div class="tabela-rola"><table class="func-docs-table">
      <thead><tr><th>Documento</th><th>Gerado em</th><th>Assinatura</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`
      : `<p class="vazio">Nenhum PDF de admissão gerado ainda.</p>`}
    <p class="meta">Texto transcrito dos modelos Word do Departamento Pessoal (RG 5.17, 5.4, 5.5, 5.6 e 5.7). O envio para assinatura usa 4 das 10 requisições/hora da D4Sign; o status volta sozinho pelo webhook.</p>`;
  if(a) $("rhd-modelo").value = RHD_CONTRATO_POR_TIPO[a.tipo_documento] || "admissao_contrato";

  $("btn-rhd-previa")?.addEventListener("click", () => rhdVisualizar($("rhd-modelo").value, _rhdFuncId, _rhdAdm?.id).catch(e => aviso("rhd-aviso", e.message || String(e), "erro")));
  $("btn-rhd-gerar")?.addEventListener("click", () => comBotaoTravado("btn-rhd-gerar", async () => {
    try {
      aviso("rhd-aviso", "Gerando PDF…", "aviso");
      await rhdGerar($("rhd-modelo").value, _rhdFuncId, _rhdAdm?.id);
      await rhdCarregar(_rhdFuncId);
      if(typeof carregarDocsFuncionario === "function") carregarDocsFuncionario();
      aviso("rhd-aviso", "PDF gerado e guardado no arquivo do funcionário.", "ok");
    } catch(e){ aviso("rhd-aviso", e.message || String(e), "erro"); }
  }));
  $("btn-rhd-gerar-admissao")?.addEventListener("click", () => comBotaoTravado("btn-rhd-gerar-admissao", async () => {
    try {
      aviso("rhd-aviso", "Gerando a ficha cadastral e o contrato…", "aviso");
      const feitos = await rhdGerarAdmissao(_rhdFuncId, _rhdAdm);
      await rhdCarregar(_rhdFuncId);
      if(typeof carregarDocsFuncionario === "function") carregarDocsFuncionario();
      aviso("rhd-aviso", `${feitos.length} PDF(s) gerado(s).`, "ok");
    } catch(e){ aviso("rhd-aviso", e.message || String(e), "erro"); }
  }));
  $("btn-rhd-concluir")?.addEventListener("click", () => comBotaoTravado("btn-rhd-concluir", async () => {
    const { error } = await sb.from("admissoes").update({ status: "concluida" }).eq("id", _rhdAdm.id);
    if(error){ aviso("rhd-aviso", "Erro: " + error.message, "erro"); return; }
    await rhdCarregar(_rhdFuncId);
  }));
  cont.querySelectorAll(".rhd-baixar").forEach(b => b.addEventListener("click", () => { const d = _rhdDocs.find(x => x.id === b.dataset.id); if(d) rhdBaixar(d.storage_path, rhdNomeArquivo(d.tipo, $("func-nome")?.value)); }));
  cont.querySelectorAll(".rhd-baixar-assinado").forEach(b => b.addEventListener("click", () => { const d = _rhdDocs.find(x => x.id === b.dataset.id); if(d) rhdBaixar(d.arquivo_assinado_path, rhdNomeArquivo(d.tipo, $("func-nome")?.value).replace(/\.pdf$/, "_assinado.pdf")); }));
  cont.querySelectorAll(".rhd-assinar").forEach(b => b.addEventListener("click", () => { const d = _rhdDocs.find(x => x.id === b.dataset.id); if(d) rhdAbrirModalAssinatura(d); }));
  cont.querySelectorAll(".rhd-status").forEach(b => b.addEventListener("click", () => rhdAtualizarStatus(b.dataset.id)));
  cont.querySelectorAll(".rhd-excluir").forEach(b => b.addEventListener("click", () => { const d = _rhdDocs.find(x => x.id === b.dataset.id); if(d) rhdExcluir(d); }));
}

/* ---------- D4Sign (segunda etapa da 93a) ---------- */
async function rhdAbrirModalAssinatura(doc){
  _rhdAlvo = doc;
  $("rhd-doc-nome").textContent = doc.descricao || doc.tipo;
  $("rhd-nome-1").value  = $("func-nome")?.value || "";
  $("rhd-email-1").value = $("func-email")?.value || "";
  $("rhd-nome-2").value  = ""; $("rhd-email-2").value = ""; $("rhd-mensagem").value = "";
  let usada = null;
  try { const r = await sb.rpc("d4sign_cota_usada"); usada = r.error ? null : r.data; } catch(_e){ /* cortesia */ }
  $("rhd-cota-nota").textContent = usada === null
    ? "O envio usa 4 das 10 requisições/hora do plano D4Sign."
    : `O envio usa 4 requisições. Cota da última hora: ${usada}/10 usadas.`;
  aviso("rhd-modal-aviso", "", "ok"); $("rhd-modal-aviso").className = "aviso";
  $("rhd-modal").style.display = "flex";
}
function rhdFecharModal(){ $("rhd-modal").style.display = "none"; _rhdAlvo = null; }

async function rhdEnviarAssinatura(){
  if(!_rhdAlvo) return;
  const signatarios = [];
  for(let i = 1; i <= 2; i++){
    const email = $(`rhd-email-${i}`).value.trim();
    if(email) signatarios.push({ email, nome: $(`rhd-nome-${i}`).value.trim() });
  }
  if(!signatarios.length){ aviso("rhd-modal-aviso", "Informe ao menos um e-mail de signatário.", "erro"); return; }
  const { data, error } = await sb.functions.invoke("d4sign-api", {
    body: { acao: "enviar_rh", documento_id: _rhdAlvo.id, signatarios, mensagem: $("rhd-mensagem").value.trim() || undefined }
  });
  if(error){
    let msg = error.message || "erro";
    try { const corpo = await error.context?.json(); if(corpo?.error) msg = corpo.error; } catch(_e){}
    aviso("rhd-modal-aviso", "Envio não realizado: " + msg, "erro");
    return;
  }
  rhdFecharModal();
  aviso("rhd-aviso", `✍️ Documento enviado para assinatura.${data?.aviso ? " " + data.aviso : ""}`, "ok");
  await rhdCarregar(_rhdFuncId);
}

async function rhdAtualizarStatus(docId){
  if(!confirm("Consultar o status na D4Sign agora? Isso usa 1 requisição da cota (o normal é o status chegar sozinho pelo webhook).")) return;
  const { data, error } = await sb.functions.invoke("d4sign-api", { body: { acao: "status_rh", documento_id: docId } });
  if(error){
    let msg = error.message || "erro";
    try { const corpo = await error.context?.json(); if(corpo?.error) msg = corpo.error; } catch(_e){}
    aviso("rhd-aviso", "Consulta falhou: " + msg, "erro");
    return;
  }
  aviso("rhd-aviso", `Status na D4Sign: ${data?.status_d4sign?.statusName || "?"}.${data?.arquivo_baixado ? " PDF assinado guardado." : ""}`, "ok");
  await rhdCarregar(_rhdFuncId);
}

/* ---------- pré-visualização em HTML (conferência do texto contra o Word) ---------- */
async function rhdVisualizar(tipo, funcionarioId, admissaoId){
  const dados = await rhdDados(funcionarioId, admissaoId);
  const html = rhdHtml(tipo, dados);
  const w = window.open("", "_blank");
  if(!w){ aviso("app-aviso", "Pop-up bloqueado. Permita pop-ups para visualizar.", "erro"); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(RHD_MODELOS[tipo].rotulo)}</title></head><body style="margin:12mm auto;max-width:190mm;background:#fff;">${html}</body></html>`);
  w.document.close();
}

function ligarRhDocumentos(){
  $("btn-rhd-enviar")?.addEventListener("click", () => comBotaoTravado("btn-rhd-enviar", rhdEnviarAssinatura));
  $("btn-rhd-cancelar")?.addEventListener("click", rhdFecharModal);
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarRhDocumentos);
} else {
  ligarRhDocumentos();
}

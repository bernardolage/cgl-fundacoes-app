/* ====================================================================
   Módulo: projeto do cliente como fundo da planta — fase 167a (prefixo ppj-)
   Carregado depois de js/estacas.js. A visão Planta da aba Estacas ganha uma barra: "Esquema" (o desenho por coordenada, que
   continua como era) e um botão por folha do projeto do cliente guardada na obra.
   - O PDF vira imagem UMA VEZ, no navegador de quem envia: a janela "Projeto do cliente" carrega o pdf.js de vendor/ por
     import() (ninguém mais baixa a biblioteca), desenha cada página marcada em duas resoluções (alta e média) e grava as
     duas no bucket obras-documentos, junto com o original, que entra em Documentos da obra (categoria projeto).
   - Quem lê abre só uma imagem por endereço assinado de 1 hora. Nada sai para host de fora e a CSP do index.html não muda.
   - Tabela public.obras_plantas (migration 20261111_fase167a_obras_plantas.sql). SEM a migration no banco a leitura acusa
     tabela ausente e o módulo se cala: a barra não aparece e a planta fica como era, sem erro do código no console.
   - As estacas por cima da folha (marcadores, modo de edição) ficam em js/planta_posicoes.js, carregado logo depois. Este
     arquivo só chama aquele por ganchos guardados por typeof: sem ele, a folha é só o fundo, com zoom e arrasto.
   - obras_plantas.rotacao_graus guarda o giro total da página (o da própria página do PDF mais o escolhido no envio). Em
     banco sem a coluna, o envio repete o insert sem o campo.
   - Grava: diretor, admin, engenheiro, assistente de engenharia e encarregado (os mesmos de estacas_write), nunca o
     usuário de revisão. O banco decide; a tela só esconde o que a pessoa não pode usar.
   As funções ppjPodeEditarCargo, ppjValidarArquivo, ppjCaminhoImagens, ppjCaminhoDocumento, ppjDimensoes, ppjPaginasPedidas,
   ppjLocaisDaObra, ppjFolhasVisiveis, ppjRotuloFolha, ppjProximaOrdem, ppjReordenar, ppjAjustar, ppjLimitar, ppjZoom,
   ppjArrastar, ppjPinca, ppjEscolherImagem, ppjTabelaAusente, ppjUrlVale, ppjBarraHTML, ppjRotacaoTotal e ppjColunaAusente
   são puras (sem tela nem banco) e testadas por scripts/testar-fase167a.mjs e scripts/testar-fase167b.mjs.
   ==================================================================== */

const PPJ_BUCKET = "obras-documentos";
const PPJ_PDFJS = "vendor/pdfjs-4.10.38.min.js";                 // pdfjs-dist 4.10.38, build/pdf.min.mjs (hash em vendor/HASHES.txt)
const PPJ_PDFJS_WORKER = "vendor/pdfjs-4.10.38.worker.min.js";   // build/pdf.worker.min.mjs
const PPJ_TAM_MAX = 52428800;            // 50 MB: o limite do bucket
const PPJ_LADO_ALTA = 6000;              // lado maior da imagem alta, em pixels
const PPJ_LADO_ALTA_REDUZIDA = 4000;     // quando o navegador não dá conta do canvas de 6.000
const PPJ_LADO_MEDIA = 2400;
const PPJ_LADO_MINIATURA = 220;
const PPJ_QUALIDADE = 0.9;               // WebP
const PPJ_ZOOM_MAX = 40;                 // vezes o "cabe na tela"
const PPJ_MAX_MINIATURAS = 40;
const PPJ_URL_SEGUNDOS = 3600;           // endereço assinado de 1 hora
const PPJ_FOLGA_MEDIA = 1.15;            // a média serve até o desenho pedir 15% a mais de pixels do que ela tem
const PPJ_TELA_ESTREITA_PX = 768;
const PPJ_VALIDADE_MS = 60000;           // a lista de folhas vale um minuto
const PPJ_AUSENTE_MS = 300000;           // tabela ausente: não pergunta de novo por 5 minutos
const PPJ_NOVA_TENTATIVA_MS = 15000;     // leitura que deu erro: espera antes de tentar outra vez
const PPJ_CARGOS_EDITAM = ["diretor", "admin", "engenheiro", "assistente_engenharia", "encarregado"];
const PPJ_COLUNAS = "id,obra_id,documento_id,pagina,titulo,local,revisao,imagem_alta_path,imagem_media_path,largura_px,altura_px,ordem,ativa,created_at,documento:obras_documentos(id,nome,storage_path)";
const PPJ_VAZIO = "Esta obra ainda não tem o projeto do cliente como fundo.";
const PPJ_VAZIO_EDITA = "Envie o PDF do projeto para ver as estacas sobre o desenho.";
const PPJ_VAZIO_LE = "Quando a engenharia enviar o projeto, ele aparece aqui.";
const PPJ_NOTA_FOLHA = "Distância mínima só é conferida no Esquema, com coordenada real.";
const PPJ_NOTA_SEM_ESTACAS = "Nesta folha as estacas ainda não são desenhadas: ela é só o fundo, com zoom e arrasto.";
const PPJ_MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const PPJ_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- quem edita ---------- */
/* a mesma lista de estacas_write (diretor entra por has_role no banco e por nome aqui); o usuário de revisão nunca grava */
function ppjPodeEditarCargo(cargo, somenteLeitura){
  return !somenteLeitura && PPJ_CARGOS_EDITAM.includes(String(cargo || ""));
}
function ppjPodeEditar(){
  if(typeof usuarioAtual === "undefined" || !usuarioAtual) return false;
  return ppjPodeEditarCargo(usuarioAtual.cargo, typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
}

/* ---------- arquivo enviado ---------- */
/* Confere o arquivo escolhido antes de qualquer leitura: PDF, PNG ou JPG, até 50 MB, com conteúdo.
   Devolve { ok, tipo: "pdf" | "imagem", ext, mime } ou { ok: false, erro }. O MIME sai da extensão, nunca do navegador. */
function ppjValidarArquivo(arq){
  if(!arq || typeof arq !== "object") return { ok: false, erro: "Escolha um arquivo." };
  const nome = String(arq.name || ""), partes = nome.split(".");
  const ext = partes.length > 1 ? partes.pop().toLowerCase() : "";
  const tam = Number(arq.size);
  if(ext === "dwg" || ext === "dxf") return { ok: false, erro: "DWG e DXF não viram fundo: peça ou exporte a prancha em PDF." };
  if(!Object.prototype.hasOwnProperty.call(PPJ_MIME, ext) || ext === "webp") return { ok: false, erro: "Envie o projeto em PDF, ou uma imagem PNG ou JPG." };
  if(!Number.isFinite(tam) || tam <= 0) return { ok: false, erro: "O arquivo está vazio." };
  if(tam > PPJ_TAM_MAX) return { ok: false, erro: "Arquivo maior que 50 MB." };
  return { ok: true, tipo: ext === "pdf" ? "pdf" : "imagem", ext, mime: PPJ_MIME[ext] };
}

/* ---------- caminhos no bucket ---------- */
/* As duas imagens de uma folha: <obra_id>/plantas/<uuid>_alta.<ext> e _media.<ext>. Obra e uuid têm de ser uuid de
   verdade e a extensão webp ou png: o caminho nunca leva texto que venha de fora. Fora disso devolve nulo. */
function ppjCaminhoImagens(obraId, uuid, ext){
  const e = String(ext || "").toLowerCase();
  if(!PPJ_UUID_RE.test(String(obraId || "")) || !PPJ_UUID_RE.test(String(uuid || "")) || (e !== "webp" && e !== "png")) return null;
  const base = `${String(obraId).toLowerCase()}/plantas/${String(uuid).toLowerCase()}`;
  return { alta: `${base}_alta.${e}`, media: `${base}_media.${e}` };
}
/* O original (PDF ou imagem) entra onde os documentos da obra entram: <obra_id>/<tempo>_<sufixo>.<ext> */
function ppjCaminhoDocumento(obraId, agoraMs, sufixo, ext){
  const e = String(ext || "").toLowerCase(), s = String(sufixo || "").toLowerCase();
  if(!PPJ_UUID_RE.test(String(obraId || "")) || !Object.prototype.hasOwnProperty.call(PPJ_MIME, e)) return null;
  if(!Number.isFinite(Number(agoraMs)) || !/^[a-z0-9]{1,12}$/.test(s)) return null;
  return `${String(obraId).toLowerCase()}/${Math.trunc(Number(agoraMs))}_${s}.${e}`;
}

/* ---------- tamanho da imagem ---------- */
/* Largura e altura em pixels inteiros para o lado maior valer `lado`, mantendo a proporção.
   ampliar = true (página de PDF, que é vetor): sempre chega ao lado pedido. ampliar = false (imagem): nunca passa do
   tamanho original. Devolve { w, h, escala } ou nulo quando a medida não serve. */
function ppjDimensoes(largura, altura, lado, ampliar){
  const w0 = Number(largura), h0 = Number(altura), l = Number(lado);
  if(!(w0 > 0) || !(h0 > 0) || !(l > 0) || !Number.isFinite(w0 + h0 + l)) return null;
  let escala = l / Math.max(w0, h0);
  if(!ampliar && escala > 1) escala = 1;
  return { w: Math.max(1, Math.round(w0 * escala)), h: Math.max(1, Math.round(h0 * escala)), escala };
}

/* ---------- giro da página ----------
   Giro total aplicado à página do PDF para gerar a imagem: o da própria página (pagina.rotate) mais o que a pessoa
   escolheu no envio. Sempre 0, 90, 180 ou 270 (é o check de obras_plantas.rotacao_graus); o que não é número vale 0. */
function ppjRotacaoTotal(rotacaoPagina, giro){
  const a = Number(rotacaoPagina), b = Number(giro), soma = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
  return ((Math.round(soma / 90) * 90) % 360 + 360) % 360;
}
/* O banco recusou por não conhecer a coluna (migration ainda não aplicada)? PostgREST: PGRST204; Postgres: 42703. */
function ppjColunaAusente(erro, coluna){
  if(!erro || !coluna) return false;
  const cod = String(erro.code || ""), msg = String(erro.message || "");
  return (cod === "PGRST204" || cod === "42703") && msg.includes(String(coluna));
}

/* ---------- páginas pedidas ---------- */
/* "1, 3-5" vira [1, 3, 4, 5]. total = páginas do PDF; maximo = quantas cabem de uma vez.
   Devolve { paginas } ou { erro }. */
function ppjPaginasPedidas(texto, total, maximo){
  const t = Number(total), max = Number(maximo) > 0 ? Number(maximo) : PPJ_MAX_MINIATURAS;
  if(!(t >= 1)) return { erro: "O arquivo não tem páginas." };
  const partes = String(texto || "").split(/[,;\s]+/).filter(Boolean), saida = new Set();
  if(!partes.length) return { erro: "Diga quais páginas são planta de locação (ex.: 1, 3-5)." };
  for(const p of partes){
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(p);
    if(!m) return { erro: `Não entendi "${p}". Use números e intervalos, como 1, 3-5.` };
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if(a < 1 || b < a || b > t) return { erro: `Página fora do arquivo: "${p}" (ele tem ${t}).` };
    if(b - a + 1 > max) return { erro: `No máximo ${max} páginas de cada vez.` };
    for(let n = a; n <= b; n++) saida.add(n);
    if(saida.size > max) return { erro: `No máximo ${max} páginas de cada vez.` };
  }
  return { paginas: [...saida].sort((x, y) => x - y) };
}

/* ---------- folhas ---------- */
/* locais da obra, tirados das estacas (o mesmo texto de estacas.local), em ordem natural */
function ppjLocaisDaObra(estacas){
  const l = (Array.isArray(estacas) ? estacas : []).map(e => String((e && e.local) || "").trim()).filter(Boolean);
  return [...new Set(l)].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}
const ppjOrdenar = (a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.titulo || "").localeCompare(String(b.titulo || ""), "pt-BR", { numeric: true });
/* As folhas que entram na barra: só as ativas. Com filtro de local, as daquele local e as sem local (que valem para
   todos); com o filtro "sem local", só as sem local. */
function ppjFolhasVisiveis(folhas, fLocal){
  const f = String(fLocal || "");
  return (Array.isArray(folhas) ? folhas : []).filter(x => x && x.ativa !== false).filter(x => {
    const l = String(x.local || "").trim();
    if(!f) return true;
    if(f === "__sem__") return !l;
    return !l || l === f;
  }).sort(ppjOrdenar);
}
/* texto do botão da folha: título e revisão */
function ppjRotuloFolha(f){
  if(!f) return "";
  const t = String(f.titulo || "").trim() || (f.pagina ? `Folha ${Number(f.pagina) || 1}` : "Folha"), r = String(f.revisao || "").trim();
  return r ? `${t} · ${r}` : t;
}
function ppjProximaOrdem(folhas){
  return (Array.isArray(folhas) ? folhas : []).reduce((m, f) => Math.max(m, Number(f && f.ordem) || 0), 0) + 1;
}
/* Sobe (delta -1) ou desce (+1) uma folha na lista. Devolve só as linhas cuja ordem muda: [{ id, ordem }]. */
function ppjReordenar(folhas, id, delta){
  const l = (Array.isArray(folhas) ? folhas : []).filter(Boolean).slice().sort(ppjOrdenar);
  const i = l.findIndex(f => f.id === id), j = i + (delta < 0 ? -1 : 1);
  if(i < 0 || j < 0 || j >= l.length) return [];
  [l[i], l[j]] = [l[j], l[i]];
  return l.map((f, k) => ({ id: f.id, ordem: k + 1, antes: Number(f.ordem) || 0 })).filter(x => x.ordem !== x.antes).map(x => ({ id: x.id, ordem: x.ordem }));
}

/* ---------- visor ----------
   A folha tem lw × lh pixels (os da imagem alta). O visor é { z, tx, ty }: um ponto (x, y) da folha aparece na tela em
   (x·z + tx, y·z + ty), em pixels do palco, que tem W × H. */
const ppjNum = (v) => typeof v === "number" && Number.isFinite(v);
/* "cabe na tela": a folha inteira, centrada */
function ppjAjustar(lw, lh, W, H){
  if(!(lw > 0) || !(lh > 0) || !(W > 0) || !(H > 0)) return { z: 1, tx: 0, ty: 0 };
  const z = Math.min(W / lw, H / lh);
  return { z, tx: (W - lw * z) / 2, ty: (H - lh * z) / 2 };
}
/* A folha não sai da tela: zoom entre o "cabe na tela" e 40 vezes ele; no eixo em que ela é menor que o palco fica
   centrada, e no que é maior não deixa faixa vazia. */
function ppjLimitar(v, lw, lh, W, H){
  const base = ppjAjustar(lw, lh, W, H);
  if(!v || !ppjNum(v.z) || !ppjNum(v.tx) || !ppjNum(v.ty) || !(v.z > 0)) return base;
  if(!(lw > 0) || !(lh > 0) || !(W > 0) || !(H > 0)) return base;
  const z = Math.min(base.z * PPJ_ZOOM_MAX, Math.max(base.z, v.z));
  const eixo = (t, tam, palco) => tam <= palco ? (palco - tam) / 2 : Math.min(0, Math.max(palco - tam, t));
  return { z, tx: eixo(v.tx, lw * z, W), ty: eixo(v.ty, lh * z, H) };
}
/* Zoom com o ponto (fx, fy) do palco parado (o cursor, ou o centro quando vier nulo). Fator inválido não mexe. */
function ppjZoom(v, fator, fx, fy, lw, lh, W, H){
  const atual = ppjLimitar(v, lw, lh, W, H);
  if(!ppjNum(fator) || !(fator > 0)) return atual;
  const base = ppjAjustar(lw, lh, W, H);
  const z = Math.min(base.z * PPJ_ZOOM_MAX, Math.max(base.z, atual.z * fator)), k = z / atual.z;
  const cx = ppjNum(fx) ? fx : W / 2, cy = ppjNum(fy) ? fy : H / 2;
  return ppjLimitar({ z, tx: cx - (cx - atual.tx) * k, ty: cy - (cy - atual.ty) * k }, lw, lh, W, H);
}
/* Arrasto: a folha anda junto com o dedo, até o limite */
function ppjArrastar(v, dx, dy, lw, lh, W, H){
  const atual = ppjLimitar(v, lw, lh, W, H);
  return ppjLimitar({ z: atual.z, tx: atual.tx + (ppjNum(dx) ? dx : 0), ty: atual.ty + (ppjNum(dy) ? dy : 0) }, lw, lh, W, H);
}
/* Pinça: antes e depois = { ax, ay, bx, by } (os dois dedos, em pixels do palco). O ponto da folha que estava entre os
   dedos continua entre eles, e o zoom muda na razão da distância. */
function ppjPinca(v, antes, depois, lw, lh, W, H){
  const atual = ppjLimitar(v, lw, lh, W, H);
  if(!antes || !depois) return atual;
  const d0 = Math.hypot(antes.ax - antes.bx, antes.ay - antes.by), d1 = Math.hypot(depois.ax - depois.bx, depois.ay - depois.by);
  if(!(d0 > 0) || !(d1 > 0) || !ppjNum(d0) || !ppjNum(d1)) return atual;
  const base = ppjAjustar(lw, lh, W, H);
  const z = Math.min(base.z * PPJ_ZOOM_MAX, Math.max(base.z, atual.z * d1 / d0));
  const m0x = (antes.ax + antes.bx) / 2, m0y = (antes.ay + antes.by) / 2, m1x = (depois.ax + depois.bx) / 2, m1y = (depois.ay + depois.by) / 2;
  const px = (m0x - atual.tx) / atual.z, py = (m0y - atual.ty) / atual.z;
  return ppjLimitar({ z, tx: m1x - px * z, ty: m1y - py * z }, lw, lh, W, H);
}

/* ---------- qual imagem abrir ----------
   o = { z, larguraAlta, larguraMedia, dpr, estreita, poucaMemoria, pediuAlta, temAlta }.
   A média abre primeiro e serve enquanto o desenho na tela não pede mais pixels do que ela tem. Passando disso, o
   computador busca a alta sozinho; tela estreita ou aparelho com pouca memória fica na média até a pessoa pedir
   ("Carregar em alta"). Depois de carregada, a alta fica. */
function ppjEscolherImagem(o){
  const p = o || {};
  if(p.temAlta || p.pediuAlta) return "alta";
  const la = Number(p.larguraAlta), lm = Number(p.larguraMedia), z = Number(p.z), dpr = Number(p.dpr) > 0 ? Number(p.dpr) : 1;
  if(!(la > 0) || !(lm > 0) || !(z > 0)) return "media";
  if(lm >= la) return "media";                                   // folha pequena: as duas imagens têm o mesmo tamanho
  if(z * la * dpr <= lm * PPJ_FOLGA_MEDIA) return "media";
  return p.estreita || p.poucaMemoria ? "media" : "alta";
}
/* largura da imagem média de uma folha, pela mesma conta de quem gerou */
function ppjLarguraMedia(folha){
  const d = folha ? ppjDimensoes(folha.largura_px, folha.altura_px, PPJ_LADO_MEDIA, false) : null;
  return d ? d.w : 0;
}

/* ---------- banco ---------- */
/* A tabela obras_plantas ainda não existe (migration não aplicada)? PostgREST: PGRST205 (ou 404 com a mensagem do
   cache de esquema); Postgres: 42P01. Qualquer outro erro é erro de verdade. */
function ppjTabelaAusente(erro){
  if(!erro) return false;
  const cod = String(erro.code || ""), msg = String(erro.message || "");
  if(cod === "PGRST205" || cod === "42P01") return true;
  return /obras_plantas/.test(msg) && /schema cache|does not exist|não existe/i.test(msg);
}
/* o endereço assinado guardado ainda vale? (um minuto de folga) */
function ppjUrlVale(reg, agoraMs){
  return !!(reg && typeof reg.url === "string" && reg.url && Number(reg.ate) - 60000 > Number(agoraMs));
}

/* ---------- HTML da barra ----------
   e = { folhas: as visíveis, atual: id da folha na tela (nulo = Esquema), total: folhas ativas da obra, podeEditar,
         erro }. Devolve o HTML da barra da planta: a alternância Esquema × folhas, os botões e o estado vazio. */
function ppjBarraHTML(e){
  const s = e || {}, folhas = Array.isArray(s.folhas) ? s.folhas : [], atual = s.atual || "";
  const naTela = folhas.find(f => f.id === atual) || null;
  const botoes = folhas.length ? `<div class="serv-views ppj-fundos" role="group" aria-label="Fundo da planta">
      <button type="button" class="serv-view-btn${naTela ? "" : " ativo"}" data-ppj-folha="" aria-pressed="${naTela ? "false" : "true"}" title="O desenho das estacas por coordenada, com a regra de distância">Esquema</button>
      ${folhas.map(f => `<button type="button" class="serv-view-btn${f.id === atual ? " ativo" : ""}" data-ppj-folha="${esc(f.id)}" aria-pressed="${f.id === atual ? "true" : "false"}" title="${esc(ppjTituloFolha(f))}">${esc(ppjRotuloFolha(f))}</button>`).join("")}
    </div>` : "";
  const enviar = s.podeEditar ? `<button type="button" class="btn-sec btn-sm" data-ppj-abrir="1" title="Enviar o PDF do projeto do cliente e cuidar das folhas desta obra">Projeto do cliente</button>` : "";
  const baixar = naTela && naTela.documento && naTela.documento.storage_path ? `<button type="button" class="btn-sec btn-sm" data-ppj-baixar="${esc(naTela.id)}" title="Baixar o arquivo original desta folha, como o cliente mandou">${esc(ppjRotuloBaixar(naTela))}</button>` : "";
  const linha = botoes || enviar || baixar ? `<div class="ppj-barra-linha">${/* html */ botoes}<span class="ppj-barra-acoes">${/* html */ baixar}${/* html */ enviar}</span></div>` : "";
  const vazio = !(Number(s.total) > 0) ? `<div class="ppj-vazio">${/* html */ uiVazio(`${PPJ_VAZIO} ${s.podeEditar ? PPJ_VAZIO_EDITA : PPJ_VAZIO_LE}`)}</div>` : "";
  const erro = s.erro ? `<p class="ppj-erro" role="alert">Não foi possível ler as folhas do projeto: ${esc(s.erro)}</p>` : "";
  return `${/* html */ vazio}${/* html */ linha}${/* html */ erro}`;
}
function ppjTituloFolha(f){
  const l = String((f && f.local) || "").trim();
  return `Folha do projeto do cliente${l ? ` · ${l}` : ""}${f && f.pagina ? ` · página ${Number(f.pagina) || 1} do arquivo` : ""}`;
}
function ppjRotuloBaixar(f){
  const nome = String((f && f.documento && f.documento.nome) || "");
  return /\.pdf$/i.test(nome) || !nome ? "Baixar o PDF original" : "Baixar o arquivo original";
}

/* ====================================================================
   Tela
   ==================================================================== */
function ppjEstadoNovo(obraId){
  return { obraId: obraId || null, folhas: null, erro: "", lendo: false, lidoEm: 0, tentouEm: 0, atual: null, chaveBarra: "",
    montada: null, visor: null, mexeu: false, res: "", carregando: "", pediuAlta: false, pedidoImg: 0, obs: null, escolheu: false };
}
let _ppj = ppjEstadoNovo(null);      // trocado inteiro a cada obra
let _ppjAusenteEm = 0;               // quando a leitura acusou tabela ausente (migration não aplicada)
const _ppjUrls = new Map();          // caminho no bucket -> { url, ate }
let _ppjPdfjs = null;                // a biblioteca, carregada uma vez e só na janela de envio
let _ppjSemRotacaoEm = 0;            // quando o banco recusou a coluna rotacao_graus (migration não aplicada)

const ppjObraId = () => (typeof obraEditId !== "undefined" && obraEditId ? obraEditId : null);
const ppjEstacas = () => (typeof _estacas !== "undefined" && Array.isArray(_estacas) ? _estacas : []);
const ppjFiltroLocal = () => { const s = $("est-f-local"); return s ? s.value || "" : ""; };
const ppjIndisponivel = () => _ppjAusenteEm > 0 && Date.now() - _ppjAusenteEm < PPJ_AUSENTE_MS;

/* Chamada por renderEstacas (js/estacas.js) no ramo da Planta. Devolve true quando há uma folha na tela (o Esquema não
   é desenhado); false quando a planta é o Esquema de sempre. */
function ppjRender(){
  const wrap = $("est-planta-wrap"), barra = $("ppj-barra"), visor = $("ppj-visor");
  if(!wrap || !barra || !visor) return false;
  const obraId = ppjObraId();
  if(obraId !== _ppj.obraId) ppjTrocarObra(obraId);
  if(!obraId || ppjIndisponivel()){ ppjEsquema(); ppjBarra(null); return false; }
  if(!_ppj.folhas){
    ppjEsquema(); ppjBarra(null);
    if(Date.now() - _ppj.tentouEm > PPJ_NOVA_TENTATIVA_MS) ppjLer();   // leitura com erro não se repete a cada tecla da busca
    return false;
  }
  if(Date.now() - Math.max(_ppj.lidoEm, _ppj.tentouEm) > PPJ_VALIDADE_MS) ppjLer();
  if(_ppj.atual && typeof renderAbasLocaisPlanta === "function") renderAbasLocaisPlanta();   // em folha o Esquema não roda, e é ele que desenha as abas de local
  const visiveis = ppjFolhasVisiveis(_ppj.folhas, ppjFiltroLocal());
  if(_ppj.atual && !visiveis.some(f => f.id === _ppj.atual)) _ppj.atual = null;
  ppjBarra(visiveis);
  const folha = _ppj.atual ? visiveis.find(f => f.id === _ppj.atual) : null;
  if(!folha){ ppjEsquema(); return false; }
  ppjMostrarFolha(folha);
  return true;
}
function ppjTrocarObra(obraId){
  if(_ppj.obs) _ppj.obs.disconnect();
  _ppj = ppjEstadoNovo(obraId);
  const visor = $("ppj-visor");
  if(visor) visor.replaceChildren();
}
/* volta a planta ao desenho por coordenada */
function ppjEsquema(){
  const wrap = $("est-planta-wrap"), visor = $("ppj-visor");
  if(wrap) wrap.classList.remove("ppj-em-folha");
  if(visor) visor.style.display = "none";
  if(typeof ppjPosSair === "function") ppjPosSair();   // voltar ao Esquema encerra o modo de edição das posições
}
function ppjBarra(visiveis){
  const barra = $("ppj-barra");
  if(!barra) return;
  if(!visiveis && !_ppj.erro){ if(barra.firstChild) barra.replaceChildren(); barra.style.display = "none"; _ppj.chaveBarra = ""; return; }
  const total = (_ppj.folhas || []).filter(f => f.ativa !== false).length;
  const html = ppjBarraHTML({ folhas: visiveis || [], atual: _ppj.atual, total: _ppj.folhas ? total : 1, podeEditar: ppjPodeEditar(), erro: _ppj.erro });
  if(html !== _ppj.chaveBarra){ barra.innerHTML = html; _ppj.chaveBarra = html; }
  barra.style.display = html ? "" : "none";
}
/* redesenha a aba pelo caminho de sempre, se a planta estiver na tela */
function ppjRedesenhar(){
  const wrap = $("est-planta-wrap");
  if(wrap && wrap.style.display !== "none" && typeof renderEstacas === "function") renderEstacas();
}

/* Lê as folhas da obra (poucas linhas). Tabela ausente = migration não aplicada: o módulo se cala por 5 minutos. */
async function ppjLer(){
  const obraId = _ppj.obraId;
  if(!obraId || _ppj.lendo) return;
  _ppj.lendo = true;
  _ppj.tentouEm = Date.now();
  const r = await Promise.resolve(sb.from("obras_plantas").select(PPJ_COLUNAS).eq("obra_id", obraId).order("ordem").order("created_at"))
    .catch(e => ({ data: null, error: e }));
  if(obraId !== _ppj.obraId) return;
  _ppj.lendo = false;
  if(r.error){
    if(ppjTabelaAusente(r.error)){ _ppjAusenteEm = Date.now(); _ppj.erro = ""; ppjBarra(null); return; }
    console.error("Projeto do cliente, leitura das folhas:", r.error);
    if(!_ppj.folhas){ _ppj.erro = r.error.message || "erro de leitura"; ppjBarra(null); }
    return;
  }
  _ppjAusenteEm = 0;
  _ppj.erro = "";
  const primeira = !_ppj.folhas, antes = JSON.stringify(_ppj.folhas || []);
  _ppj.folhas = r.data || [];
  _ppj.lidoEm = Date.now();
  if(primeira){
    const wrap = $("est-planta-wrap");
    if(wrap && wrap.style.display !== "none") ppjRender();   // a planta abre no Esquema, que já está desenhado
    if(typeof ppjPosAbrirPrimeira === "function") ppjPosAbrirPrimeira();   // e passa para a primeira folha, se ela já tem estaca posicionada
  }
  else if(JSON.stringify(_ppj.folhas) !== antes) ppjRedesenhar();
}

/* ---------- endereço assinado ---------- */
async function ppjUrlAssinada(caminho){
  const reg = _ppjUrls.get(caminho);
  if(ppjUrlVale(reg, Date.now())) return reg.url;
  const { data, error } = await sb.storage.from(PPJ_BUCKET).createSignedUrl(caminho, PPJ_URL_SEGUNDOS);
  if(error || !data || !data.signedUrl) throw new Error(error ? error.message : "sem endereço");
  _ppjUrls.set(caminho, { url: data.signedUrl, ate: Date.now() + PPJ_URL_SEGUNDOS * 1000 });
  return data.signedUrl;
}

/* ---------- visor da folha ---------- */
function ppjAparelhoRestrito(){
  const estreita = typeof window !== "undefined" && window.innerWidth < PPJ_TELA_ESTREITA_PX;
  const mem = typeof navigator !== "undefined" ? Number(navigator.deviceMemory) : NaN;
  return { estreita, poucaMemoria: mem > 0 && mem < 4 };
}
function ppjFolhaAtual(){ return (_ppj.folhas || []).find(f => f.id === _ppj.atual) || null; }
function ppjMostrarFolha(folha){
  const wrap = $("est-planta-wrap"), visor = $("ppj-visor");
  wrap.classList.add("ppj-em-folha");
  visor.style.display = "";
  const chave = [folha.id, folha.titulo, folha.revisao, folha.local, folha.imagem_alta_path].join("|");
  if(_ppj.montada === chave && visor.firstChild){
    ppjAplicarVisor();
    if(typeof ppjPosAtualizar === "function") ppjPosAtualizar(folha);   // filtros, cor e status das estacas podem ter mudado
    return;
  }
  _ppj.montada = chave;
  _ppj.visor = null; _ppj.mexeu = false; _ppj.res = ""; _ppj.carregando = ""; _ppj.pediuAlta = false; _ppj.pedidoImg++;
  if(_ppj.obs){ _ppj.obs.disconnect(); _ppj.obs = null; }
  const local = String(folha.local || "").trim();
  visor.innerHTML = `<div class="ppj-ferramentas" id="ppj-ferramentas" hidden></div>
    <div class="ppj-area" id="ppj-area">
    <div class="ppj-palco" id="ppj-palco" tabindex="0" role="group" aria-label="${esc("Folha do projeto do cliente: " + ppjRotuloFolha(folha))}">
      <img id="ppj-img" class="ppj-img" alt="${esc("Folha do projeto do cliente: " + ppjRotuloFolha(folha))}" draggable="false" />
      <p class="ppj-estado" id="ppj-estado">Carregando a folha…</p>
      <div class="ppj-controles">
        <button type="button" class="btn-sec btn-sm" data-ppj-zoom="mais" title="Aproximar" aria-label="Aproximar">+</button>
        <button type="button" class="btn-sec btn-sm" data-ppj-zoom="menos" title="Afastar" aria-label="Afastar">−</button>
        <button type="button" class="btn-sec btn-sm" data-ppj-zoom="ajustar" title="Mostrar a folha inteira" aria-label="Mostrar a folha inteira">⛶</button>
        <button type="button" class="btn-sec btn-sm" data-ppj-zoom="cheia" title="Abrir ou fechar a tela cheia" aria-label="Abrir ou fechar a tela cheia">⤢</button>
      </div>
    </div>
    <aside class="ppj-painel" id="ppj-painel" aria-label="Estacas sem posição nesta folha" hidden></aside>
    </div>
    <p class="ppj-rodape"><span id="ppj-contagem" class="ppj-contagem"></span><span id="ppj-res" class="ppj-res"></span>${local ? `<span>Local: ${esc(local)}</span>` : ""}<button type="button" class="btn-sec btn-sm" id="btn-ppj-alta" hidden title="Baixar a imagem maior desta folha, para ver os detalhes com nitidez. Usa mais dados e memória.">Carregar em alta</button></p>
    <p class="ppj-nota">${esc(PPJ_NOTA_FOLHA)} <span id="ppj-nota-sem">${esc(PPJ_NOTA_SEM_ESTACAS)}</span></p>`;
  const palco = $("ppj-palco"), img = $("ppj-img");
  img.style.width = folha.largura_px + "px";
  img.style.height = folha.altura_px + "px";
  ppjLigarPalco(palco);
  if(typeof ppjPosMontar === "function") ppjPosMontar(folha, palco);   // as estacas por cima da folha
  if(typeof ResizeObserver === "function"){
    _ppj.obs = new ResizeObserver(() => ppjAplicarVisor());
    _ppj.obs.observe(palco);
  }
  ppjAplicarVisor();
  ppjCarregarImagem(folha, "media");
}
function ppjTamanho(){
  const palco = $("ppj-palco"), folha = ppjFolhaAtual();
  if(!palco || !folha) return null;
  const W = palco.clientWidth, H = palco.clientHeight;
  return W > 0 && H > 0 ? { W, H, lw: Number(folha.largura_px), lh: Number(folha.altura_px), folha } : null;
}
/* aplica o visor à imagem e decide se é hora de buscar a alta. Palco sem tamanho (aba escondida): espera o ResizeObserver. */
function ppjAplicarVisor(){
  const t = ppjTamanho(), img = $("ppj-img");
  if(!t || !img) return;
  _ppj.visor = _ppj.visor && _ppj.mexeu ? ppjLimitar(_ppj.visor, t.lw, t.lh, t.W, t.H) : ppjAjustar(t.lw, t.lh, t.W, t.H);
  const v = _ppj.visor;
  img.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.z})`;
  if(typeof ppjPosVisor === "function") ppjPosVisor(v, t);   // os marcadores acompanham a folha
  const r = ppjAparelhoRestrito(), temAlta = _ppj.res === "alta";
  const qual = ppjEscolherImagem({ z: v.z, larguraAlta: t.lw, larguraMedia: ppjLarguraMedia(t.folha), dpr: window.devicePixelRatio || 1,
    estreita: r.estreita, poucaMemoria: r.poucaMemoria, pediuAlta: _ppj.pediuAlta, temAlta });
  if(qual === "alta" && !temAlta && _ppj.res === "media" && _ppj.carregando !== "alta") ppjCarregarImagem(t.folha, "alta");
  const botao = $("btn-ppj-alta");
  if(botao) botao.hidden = !(!temAlta && _ppj.res === "media" && _ppj.carregando !== "alta" && (r.estreita || r.poucaMemoria) && ppjLarguraMedia(t.folha) < t.lw);
}
function ppjMexer(visor){ _ppj.visor = visor; _ppj.mexeu = true; ppjAplicarVisor(); }
/* carrega a imagem (média ou alta) pelo endereço assinado; a que está na tela fica até a nova estar pronta */
async function ppjCarregarImagem(folha, qual){
  const pedido = ++_ppj.pedidoImg, estado = $("ppj-estado");
  _ppj.carregando = qual;
  const texto = (msg) => { const e = $("ppj-estado"); if(e){ e.textContent = msg; e.hidden = !msg; } };
  if(qual === "alta") ppjRes("carregando a imagem em alta…"); else if(estado) texto("Carregando a folha…");
  try {
    const url = await ppjUrlAssinada(qual === "alta" ? folha.imagem_alta_path : folha.imagem_media_path);
    await new Promise((ok, falha) => { const pre = new Image(); pre.onload = ok; pre.onerror = () => falha(new Error("a imagem não abriu")); pre.src = url; });
    if(pedido !== _ppj.pedidoImg || folha.id !== _ppj.atual) return;
    const img = $("ppj-img");
    if(!img) return;
    img.src = url;
    _ppj.res = qual; _ppj.carregando = "";
    texto("");
    ppjRes(qual === "alta" ? `imagem em alta (${Number(folha.largura_px)} × ${Number(folha.altura_px)} px)` : "imagem média");
    ppjAplicarVisor();
  } catch(e){
    if(pedido !== _ppj.pedidoImg || folha.id !== _ppj.atual) return;
    _ppj.carregando = "";
    _ppjUrls.delete(qual === "alta" ? folha.imagem_alta_path : folha.imagem_media_path);
    console.error("Projeto do cliente, imagem da folha:", e);
    if(_ppj.res) ppjRes("imagem média (a alta não abriu)");
    else texto("Não foi possível abrir a imagem desta folha. Troque de folha e volte, ou recarregue a página.");
    ppjAplicarVisor();
  }
}
function ppjRes(msg){ const el = $("ppj-res"); if(el) el.textContent = msg; }

/* arrasto, roda do mouse, pinça, teclado e os botões do palco */
function ppjLigarPalco(palco){
  const dedos = new Map();
  // ponto do palco na origem da imagem: o canto de dentro da borda (sem descontá-la, o ponto sob o cursor escorregava no zoom: 2 px em 6 passos da roda)
  const pos = (ev) => { const r = palco.getBoundingClientRect(); return { x: ev.clientX - r.left - (palco.clientLeft || 0), y: ev.clientY - r.top - (palco.clientTop || 0) }; };
  const par = () => { const [a, b] = [...dedos.values()]; return { ax: a.x, ay: a.y, bx: b.x, by: b.y }; };
  palco.addEventListener("pointerdown", (ev) => {
    if(ev.target.closest(".ppj-controles")) return;
    if(ev.pointerType === "mouse" && ev.button !== 0) return;
    if(typeof ppjPosAgarrar === "function" && ppjPosAgarrar(ev, pos(ev))) return;   // marcador arrastado no modo de edição: a folha não anda
    dedos.set(ev.pointerId, pos(ev));
    try { palco.setPointerCapture(ev.pointerId); } catch(e){ /* ponteiro já solto */ }
    palco.classList.add("ppj-arrastando");
  });
  palco.addEventListener("pointermove", (ev) => {
    const d = dedos.get(ev.pointerId), t = ppjTamanho();
    if(!d || !t || !_ppj.visor) return;
    const p = pos(ev);
    if(dedos.size === 1){
      ppjMexer(ppjArrastar(_ppj.visor, p.x - d.x, p.y - d.y, t.lw, t.lh, t.W, t.H));
      d.x = p.x; d.y = p.y;
      return;
    }
    if(dedos.size !== 2) return;
    const antes = par();
    d.x = p.x; d.y = p.y;
    ppjMexer(ppjPinca(_ppj.visor, antes, par(), t.lw, t.lh, t.W, t.H));
  });
  const soltar = (ev) => { dedos.delete(ev.pointerId); if(!dedos.size) palco.classList.remove("ppj-arrastando"); };
  palco.addEventListener("pointerup", soltar);
  palco.addEventListener("pointercancel", soltar);
  palco.addEventListener("wheel", (ev) => {
    const t = ppjTamanho();
    if(!t || !_ppj.visor) return;
    ev.preventDefault();
    const p = pos(ev);
    ppjMexer(ppjZoom(_ppj.visor, ev.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y, t.lw, t.lh, t.W, t.H));
  }, { passive: false });
  palco.addEventListener("keydown", (ev) => {
    const t = ppjTamanho();
    if(!t || !_ppj.visor || ev.target !== palco) return;
    const passo = 60, mover = { ArrowLeft: [passo, 0], ArrowRight: [-passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] }[ev.key];
    if(mover){ ev.preventDefault(); ppjMexer(ppjArrastar(_ppj.visor, mover[0], mover[1], t.lw, t.lh, t.W, t.H)); }
    else if(ev.key === "+" || ev.key === "="){ ev.preventDefault(); ppjMexer(ppjZoom(_ppj.visor, 1.4, null, null, t.lw, t.lh, t.W, t.H)); }
    else if(ev.key === "-"){ ev.preventDefault(); ppjMexer(ppjZoom(_ppj.visor, 1 / 1.4, null, null, t.lw, t.lh, t.W, t.H)); }
    else if(ev.key === "0"){ ev.preventDefault(); _ppj.mexeu = false; ppjAplicarVisor(); }
    else if(ev.key === "Escape" && palco.classList.contains("ppj-cheia")){ ev.preventDefault(); ppjTelaCheia(palco); }
  });
  palco.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ppj-zoom]"), t = ppjTamanho();
    if(!b || !t || !_ppj.visor) return;
    const acao = b.dataset.ppjZoom;
    if(acao === "ajustar"){ _ppj.mexeu = false; ppjAplicarVisor(); }
    else if(acao === "cheia") ppjTelaCheia(palco);
    else ppjMexer(ppjZoom(_ppj.visor, acao === "mais" ? 1.4 : 1 / 1.4, null, null, t.lw, t.lh, t.W, t.H));
  });
}
/* tela cheia do navegador quando ele tem; senão o palco cobre a janela (iPhone) */
function ppjTelaCheia(palco){
  if(document.fullscreenElement === palco){ document.exitFullscreen(); return; }
  if(palco.classList.contains("ppj-cheia")){ palco.classList.remove("ppj-cheia"); ppjAplicarVisor(); return; }
  if(typeof palco.requestFullscreen === "function"){ palco.requestFullscreen().catch(() => { palco.classList.add("ppj-cheia"); ppjAplicarVisor(); }); return; }
  palco.classList.add("ppj-cheia");
  ppjAplicarVisor();
}

/* ---------- baixar o original ---------- */
async function ppjBaixarOriginal(folhaId){
  const f = (_ppj.folhas || []).find(x => x.id === folhaId), doc = f && f.documento;
  if(!doc || !doc.storage_path){ aviso("app-aviso", "Esta folha não tem o arquivo original guardado.", "erro"); return; }
  const { data, error } = await sb.storage.from(PPJ_BUCKET).createSignedUrl(doc.storage_path, 60);
  if(error || !data){ aviso("app-aviso", "Não foi possível baixar o original: " + (error ? error.message : "sem endereço"), "erro"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl; a.download = doc.nome || "projeto.pdf"; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

/* ====================================================================
   Gerar as imagens (só no navegador de quem envia)
   ==================================================================== */
const ppjUrlLocal = (arq) => new URL(arq, document.baseURI).href;
/* a biblioteca só entra aqui, por import(), e fica na memória da aba */
function ppjPdfjs(){
  if(!_ppjPdfjs){
    _ppjPdfjs = import(ppjUrlLocal(PPJ_PDFJS)).then(lib => { lib.GlobalWorkerOptions.workerSrc = ppjUrlLocal(PPJ_PDFJS_WORKER); return lib; });
    _ppjPdfjs.catch(() => { _ppjPdfjs = null; });
  }
  return _ppjPdfjs;
}
/* abre o PDF (dados = ArrayBuffer). isEvalSupported: false: a CSP do app não deixa a biblioteca compilar função. */
async function ppjAbrirPdf(dados){
  const lib = await ppjPdfjs();
  return lib.getDocument({ data: new Uint8Array(dados), isEvalSupported: false, enableXfa: false }).promise;
}
/* o canvas deste tamanho funciona neste navegador? (acima do limite ele existe, mas não guarda pixel nenhum) */
function ppjCanvasNovo(w, h){
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if(!ctx || canvas.width !== w || canvas.height !== h) return null;
  try {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    const px = ctx.getImageData(w - 1, h - 1, 1, 1).data;
    if(px[0] !== 255 || px[3] !== 255) return null;
  } catch(e){ return null; }
  return { canvas, ctx };
}
function ppjSoltarCanvas(canvas){ if(canvas){ canvas.width = 0; canvas.height = 0; } }
/* Desenha a fonte (página de PDF ou imagem) com o lado maior pedido e o giro (0, 90, 180, 270). Devolve o canvas. */
async function ppjDesenhar(fonte, lado, giro){
  const g = ((Number(giro) || 0) % 360 + 360) % 360;
  if(fonte.tipo === "pdf"){
    const pagina = await fonte.pdf.getPage(fonte.pagina);
    const rot = ppjRotacaoTotal(pagina.rotate, g), base = pagina.getViewport({ scale: 1, rotation: rot });
    const d = ppjDimensoes(base.width, base.height, lado, true);
    if(!d) throw new Error("página sem tamanho");
    const c = ppjCanvasNovo(d.w, d.h);
    if(!c) throw new Error("canvas");
    await pagina.render({ canvasContext: c.ctx, viewport: pagina.getViewport({ scale: d.escala, rotation: rot }) }).promise;
    return c.canvas;
  }
  const deitada = g === 90 || g === 270, iw = fonte.imagem.naturalWidth || fonte.imagem.width, ih = fonte.imagem.naturalHeight || fonte.imagem.height;
  const d = ppjDimensoes(deitada ? ih : iw, deitada ? iw : ih, lado, false);
  if(!d) throw new Error("imagem sem tamanho");
  const c = ppjCanvasNovo(d.w, d.h);
  if(!c) throw new Error("canvas");
  c.ctx.imageSmoothingQuality = "high";
  c.ctx.translate(d.w / 2, d.h / 2);
  c.ctx.rotate(g * Math.PI / 180);
  c.ctx.drawImage(fonte.imagem, -(deitada ? d.h : d.w) / 2, -(deitada ? d.w : d.h) / 2, deitada ? d.h : d.w, deitada ? d.w : d.h);
  return c.canvas;
}
/* canvas -> arquivo: WebP 0,9; PNG se o navegador não gerar WebP */
function ppjCanvasArquivo(canvas){
  const para = (tipo, q) => new Promise(ok => canvas.toBlob(ok, tipo, q));
  return para("image/webp", PPJ_QUALIDADE).then(b => b && b.type === "image/webp" ? { blob: b, ext: "webp" }
    : para("image/png").then(p => { if(!p) throw new Error("o navegador não gerou a imagem"); return { blob: p, ext: "png" }; }));
}
/* As duas imagens de uma folha. A alta tenta 6.000 px e cai para 4.000 se o canvas falhar ou o arquivo passar de 50 MB.
   Devolve { alta, media, ext, largura, altura, rotacao } (largura e altura são as da alta; rotacao é o giro total da
   página do PDF, 0 para imagem enviada direto). */
async function ppjGerarImagens(fonte, giro){
  let alta = null, dim = null, ultimo = null;
  for(const lado of [PPJ_LADO_ALTA, PPJ_LADO_ALTA_REDUZIDA]){
    let canvas = null;
    try {
      canvas = await ppjDesenhar(fonte, lado, giro);
      const arq = await ppjCanvasArquivo(canvas);
      if(arq.blob.size > PPJ_TAM_MAX) throw new Error("a imagem passou de 50 MB");
      alta = arq; dim = { w: canvas.width, h: canvas.height };
    } catch(e){ ultimo = e; }
    ppjSoltarCanvas(canvas);
    if(alta) break;
  }
  if(!alta) throw new Error("O navegador não conseguiu gerar a imagem desta folha" + (ultimo && ultimo.message && ultimo.message !== "canvas" ? ` (${ultimo.message})` : "") + ".");
  const cm = await ppjDesenhar(fonte, Math.min(PPJ_LADO_MEDIA, Math.max(dim.w, dim.h)), giro);
  let media = await ppjCanvasArquivo(cm);
  ppjSoltarCanvas(cm);
  if(media.ext !== alta.ext){   // as duas no mesmo formato: o caminho leva uma extensão só
    const c2 = await ppjDesenhar(fonte, Math.min(PPJ_LADO_MEDIA, Math.max(dim.w, dim.h)), giro);
    media = { blob: await new Promise(ok => c2.toBlob(ok, "image/png")), ext: "png" };
    ppjSoltarCanvas(c2);
    if(alta.ext !== "png" || !media.blob) throw new Error("O navegador gerou as duas imagens em formatos diferentes.");
  }
  const giroTotal = fonte.tipo === "pdf" ? ppjRotacaoTotal((await fonte.pdf.getPage(fonte.pagina)).rotate, giro) : 0;
  return { alta: alta.blob, media: media.blob, ext: alta.ext, largura: dim.w, altura: dim.h, rotacao: giroTotal };
}

/* ====================================================================
   Janela "Projeto do cliente": enviar e cuidar das folhas
   ==================================================================== */
let _ppjGuardados = [];  // PDFs de projeto já guardados na obra, lidos ao abrir a janela
let _ppjEnvio = null;   // { arquivo, guardado, info, fonte: { tipo, pdf | imagem }, total, paginas: [{ n, giro }], ocupado }

function ppjAbrirJanela(){
  const modal = $("ppj-modal");
  if(!modal || !ppjPodeEditar() || !_ppj.obraId) return;
  ppjSoltarEnvio();
  _ppjGuardados = [];
  $("ppj-corpo").innerHTML = ppjJanelaHTML([]);
  ppjAvisoJanela("");
  modal.style.display = "flex";
  $("btn-ppj-fechar")?.focus();
  ppjListarGuardados();
}
function ppjFecharJanela(){
  const modal = $("ppj-modal");
  if(!modal || modal.style.display === "none") return;
  if(_ppjEnvio && _ppjEnvio.ocupado){ ppjAvisoJanela("Aguarde: o envio das folhas ainda não terminou.", "aviso"); return; }   // no meio de um envio a janela não fecha
  modal.style.display = "none";
  ppjSoltarEnvio();
  $("ppj-corpo").replaceChildren();
}
function ppjSoltarEnvio(){
  const e = _ppjEnvio;
  _ppjEnvio = null;
  if(e && e.fonte && e.fonte.pdf && typeof e.fonte.pdf.destroy === "function") e.fonte.pdf.destroy().catch(() => {});
  if(e && e.urlImagem) URL.revokeObjectURL(e.urlImagem);
}
function ppjAvisoJanela(msg, tipo){
  const el = $("ppj-aviso");
  if(!el) return;
  if(!msg){ el.textContent = ""; el.className = "aviso"; return; }
  aviso("ppj-aviso", msg, tipo || "erro");
}
function ppjOpcoesLocal(valor){
  const locais = ppjLocaisDaObra(ppjEstacas()), v = String(valor || "").trim();
  const lista = v && !locais.includes(v) ? locais.concat(v) : locais;
  return `<option value="">Sem local (vale para todos)</option>${lista.map(l => `<option value="${esc(l)}"${l === v ? " selected" : ""}>${esc(l)}</option>`).join("")}`;
}
const ppjTemLocais = () => ppjLocaisDaObra(ppjEstacas()).length > 0 || (_ppj.folhas || []).some(f => String(f.local || "").trim());
/* PDFs de projeto que a obra já tem em Documentos: lista para escolher em vez de enviar de novo */
function ppjGuardadosHTML(pdfs){
  const l = Array.isArray(pdfs) ? pdfs : [];
  if(!l.length) return "";
  return `<div class="campo"><label for="ppj-guardado">ou use um PDF de projeto já guardado nos Documentos desta obra</label>
      <div class="ppj-linha"><select id="ppj-guardado"><option value="">Escolha…</option>${l.map(d => `<option value="${esc(d.id)}">${esc(d.nome)}</option>`).join("")}</select>
      <button type="button" class="btn-sec btn-sm" id="btn-ppj-guardado" title="Abrir o PDF escolhido para marcar as páginas que são planta">Abrir</button></div></div>`;
}
function ppjJanelaHTML(guardados){
  const temLocais = ppjTemLocais(), lista = ppjGuardadosHTML(guardados);
  const enviar = `<p class="texto-apoio">Escolha o PDF do projeto do cliente (até 50 MB). O PDF vira imagem aqui, no seu computador, e fica guardado na obra junto com o original. Projeto escaneado também serve: envie a imagem PNG ou JPG.</p>
    <div class="campo"><label for="ppj-arquivo">Arquivo do projeto</label><input id="ppj-arquivo" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" /></div>
    <div id="ppj-guardados">${/* html */ lista}</div>
    <div id="ppj-paginas"></div>`;
  return `${/* html */ uiSecao("documento", "Enviar projeto", enviar)}${/* html */ uiSecao("foto", "Folhas desta obra", `<div id="ppj-folhas">${/* html */ ppjFolhasHTML(_ppj.folhas || [], temLocais)}</div>`, String((_ppj.folhas || []).length))}`;
}
/* a lista "Folhas desta obra": renomear, trocar local e revisão, reordenar, desativar, baixar o original e excluir */
function ppjFolhasHTML(folhas, temLocais){
  const l = (folhas || []).slice().sort(ppjOrdenar);
  if(!l.length) return uiVazio("Nenhuma folha ainda. Envie o projeto acima e marque as páginas que são planta de locação.");
  return l.map((f, k) => `<div class="ppj-folha${f.ativa === false ? " ppj-inativa" : ""}" data-ppj-id="${esc(f.id)}">
      <div class="campo"><label>Título</label><input data-ppj-edita="titulo" value="${esc(f.titulo || "")}" maxlength="80" /></div>
      ${temLocais ? `<div class="campo"><label>Local</label><select data-ppj-edita="local">${/* html */ ppjOpcoesLocal(f.local)}</select></div>` : ""}
      <div class="campo"><label>Revisão</label><input data-ppj-edita="revisao" value="${esc(f.revisao || "")}" maxlength="30" placeholder="ex.: R02" /></div>
      <div class="ppj-folha-acoes">
        <span class="ppj-folha-meta">página ${Number(f.pagina) || 1} · ${Number(f.largura_px) || 0} × ${Number(f.altura_px) || 0} px${f.ativa === false ? " · desativada" : ""}</span>
        <button type="button" class="btn-sec btn-sm" data-ppj-acao="subir" title="Subir esta folha na barra da planta" aria-label="Subir esta folha"${k === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="btn-sec btn-sm" data-ppj-acao="descer" title="Descer esta folha na barra da planta" aria-label="Descer esta folha"${k === l.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="btn-sec btn-sm" data-ppj-acao="ativar" title="${f.ativa === false ? "Voltar a mostrar esta folha na barra da planta" : "Tirar esta folha da barra da planta, sem apagar nada"}">${f.ativa === false ? "Reativar" : "Desativar"}</button>
        ${f.documento && f.documento.storage_path ? `<button type="button" class="btn-sec btn-sm" data-ppj-acao="baixar" title="Baixar o arquivo original desta folha, como o cliente mandou">${esc(ppjRotuloBaixar(f))}</button>` : ""}
        <button type="button" class="btn-sec btn-sm txt-perigo" data-ppj-acao="excluir" title="Apagar esta folha, as duas imagens dela e a posição das estacas marcadas nela. O arquivo original continua nos Documentos da obra.">Excluir</button>
      </div>
    </div>`).join("");
}
function ppjAtualizarFolhasJanela(){
  const el = $("ppj-folhas");
  if(el) el.innerHTML = ppjFolhasHTML(_ppj.folhas || [], ppjTemLocais());
}
/* PDFs de categoria projeto que a obra já tem em Documentos */
async function ppjListarGuardados(){
  const obraId = _ppj.obraId;
  const { data, error } = await sb.from("obras_documentos").select("id,nome,storage_path,mime_type,created_at").eq("obra_id", obraId).eq("categoria", "projeto").order("created_at", { ascending: false });
  if(error || obraId !== _ppj.obraId || !$("ppj-guardados")) return;
  _ppjGuardados = (data || []).filter(d => /\.pdf$/i.test(d.nome || "") || d.mime_type === "application/pdf");
  $("ppj-guardados").innerHTML = ppjGuardadosHTML(_ppjGuardados);
}

/* abre o arquivo escolhido no computador */
async function ppjAbrirArquivo(arquivo){
  const info = ppjValidarArquivo(arquivo);
  ppjAvisoJanela("");
  if(!info.ok){ ppjAvisoJanela(info.erro); return; }
  await ppjPrepararEnvio({ arquivo, guardado: null, info, nome: arquivo.name }, () => arquivo.arrayBuffer());
}
/* abre um PDF que já está nos Documentos da obra */
async function ppjAbrirGuardado(){
  const id = $("ppj-guardado")?.value, doc = _ppjGuardados.find(d => d.id === id);
  ppjAvisoJanela("");
  if(!doc){ ppjAvisoJanela("Escolha um PDF da lista."); return; }
  await ppjPrepararEnvio({ arquivo: null, guardado: doc, info: { ok: true, tipo: "pdf", ext: "pdf", mime: PPJ_MIME.pdf }, nome: doc.nome }, async () => {
    const { data, error } = await sb.storage.from(PPJ_BUCKET).download(doc.storage_path);
    if(error || !data) throw new Error(error ? error.message : "arquivo não encontrado");
    return data.arrayBuffer();
  });
}
async function ppjPrepararEnvio(base, lerDados){
  const area = $("ppj-paginas");
  if(!area) return;
  ppjSoltarEnvio();
  area.innerHTML = uiVazio("Abrindo o arquivo…");
  const envio = { ...base, fonte: null, total: 1, paginas: [], ocupado: false, urlImagem: "" };
  _ppjEnvio = envio;
  try {
    if(base.info.tipo === "pdf"){
      const pdf = await ppjAbrirPdf(await lerDados());
      if(_ppjEnvio !== envio){ pdf.destroy().catch(() => {}); return; }
      envio.fonte = { tipo: "pdf", pdf };
      envio.total = pdf.numPages;
    } else {
      envio.urlImagem = URL.createObjectURL(base.arquivo);
      const imagem = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error("a imagem não abriu")); i.src = envio.urlImagem; });
      if(_ppjEnvio !== envio) return;
      envio.fonte = { tipo: "imagem", imagem };
    }
  } catch(e){
    if(_ppjEnvio !== envio) return;
    _ppjEnvio = null;
    area.replaceChildren();
    const senha = e && (e.name === "PasswordException" || /password/i.test(e.message || ""));
    ppjAvisoJanela(senha ? "Este PDF tem senha. Salve uma cópia sem senha e envie de novo." : "Não foi possível abrir o arquivo: " + ((e && e.message) || e));
    return;
  }
  if(envio.total > PPJ_MAX_MINIATURAS){
    area.innerHTML = `<p class="texto-apoio">${esc(base.nome)} tem ${Number(envio.total)} páginas. Diga quais são planta de locação (até ${PPJ_MAX_MINIATURAS} de cada vez).</p>
      <div class="ppj-linha"><input id="ppj-quais" placeholder="ex.: 1, 3-5" aria-label="Páginas que são planta de locação" /><button type="button" class="btn-sec btn-sm" id="btn-ppj-quais" title="Mostrar as páginas pedidas para conferir antes de gerar">Mostrar</button></div>
      <div id="ppj-cartoes"></div>`;
    return;
  }
  area.innerHTML = `<div id="ppj-cartoes"></div>`;
  await ppjMostrarPaginas(Array.from({ length: envio.total }, (_, k) => k + 1));
}
/* os cartões das páginas, com a miniatura de cada uma */
async function ppjMostrarPaginas(numeros){
  const envio = _ppjEnvio, cont = $("ppj-cartoes");
  if(!envio || !cont) return;
  const temLocais = ppjLocaisDaObra(ppjEstacas()).length > 0, uma = numeros.length === 1, localPadrao = ppjFiltroLocal() === "__sem__" ? "" : ppjFiltroLocal();
  envio.paginas = numeros.map(n => ({ n, giro: 0 }));
  cont.innerHTML = `<p class="texto-apoio">${uma ? "Confira a folha e gere a imagem." : "Marque as páginas que são planta de locação. As outras ficam só no arquivo original."}</p>
    <div class="ppj-grade">${numeros.map(n => `<div class="ppj-pag" data-ppj-pag="${Number(n)}">
      <div class="ppj-mini" data-ppj-mini="${Number(n)}"><span class="ppj-mini-txt">página ${Number(n)}</span></div>
      <label class="ppj-check"><input type="checkbox" data-ppj-campo="usar"${uma ? " checked" : ""} /> Planta de locação</label>
      <div class="campo"><label>Título</label><input data-ppj-campo="titulo" value="Folha ${Number(n)}" maxlength="80" /></div>
      ${temLocais ? `<div class="campo"><label>Local</label><select data-ppj-campo="local">${/* html */ ppjOpcoesLocal(localPadrao)}</select></div>` : ""}
      <div class="campo"><label>Revisão</label><input data-ppj-campo="revisao" maxlength="30" placeholder="ex.: R02" /></div>
      <button type="button" class="btn-sec btn-sm" data-ppj-girar="${Number(n)}" title="Girar a página 90° antes de gerar a imagem">Girar 90°</button>
    </div>`).join("")}</div>
    <div class="form-acoes compacta"><span id="ppj-progresso" class="ppj-progresso" role="status"></span><button type="button" class="btn" id="btn-ppj-gerar" title="Gerar a imagem de cada página marcada e guardar na obra">Gerar folhas</button></div>`;
  for(const n of numeros){
    if(_ppjEnvio !== envio) return;
    await ppjMiniatura(n);
  }
}
async function ppjMiniatura(n){
  const envio = _ppjEnvio, pag = envio && envio.paginas.find(p => p.n === n), alvo = document.querySelector(`[data-ppj-mini="${Number(n)}"]`);
  if(!envio || !pag || !alvo) return;
  try {
    const canvas = await ppjDesenhar({ ...envio.fonte, pagina: n }, PPJ_LADO_MINIATURA, pag.giro);
    if(_ppjEnvio !== envio || !alvo.isConnected) return;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Miniatura da página ${Number(n)}`);
    alvo.replaceChildren(canvas);
  } catch(e){
    console.error("Projeto do cliente, miniatura:", e);
    if(alvo.isConnected) alvo.textContent = "A miniatura não saiu.";
  }
}

/* Gera e grava as folhas marcadas, uma de cada vez. O original só sobe depois de a primeira imagem sair; se uma folha
   falhar, as imagens dela saem do Storage e o envio para ali (as folhas já gravadas ficam). */
async function ppjGerar(){
  const envio = _ppjEnvio, obraId = _ppj.obraId;
  if(!envio || !envio.fonte || envio.ocupado || !obraId) return;
  const marcadas = [];
  for(const p of envio.paginas){
    const cartao = document.querySelector(`[data-ppj-pag="${Number(p.n)}"]`);
    if(!cartao || !cartao.querySelector('[data-ppj-campo="usar"]')?.checked) continue;
    const titulo = (cartao.querySelector('[data-ppj-campo="titulo"]')?.value || "").trim();
    if(!titulo){ ppjAvisoJanela(`Dê um título à página ${p.n}.`); return; }
    marcadas.push({ n: p.n, giro: p.giro, titulo, local: (cartao.querySelector('[data-ppj-campo="local"]')?.value || "").trim() || null,
      revisao: (cartao.querySelector('[data-ppj-campo="revisao"]')?.value || "").trim() || null });
  }
  if(!marcadas.length){ ppjAvisoJanela("Marque ao menos uma página como planta de locação."); return; }
  ppjAvisoJanela("");
  const progresso = (msg) => { const el = $("ppj-progresso"); if(el) el.textContent = msg; };
  const botao = $("btn-ppj-gerar");
  envio.ocupado = true;
  if(botao) botao.disabled = true;
  let documentoId = envio.guardado ? envio.guardado.id : null, docNovo = null, feitas = 0, ordem = ppjProximaOrdem(_ppj.folhas);
  const bucket = sb.storage.from(PPJ_BUCKET);
  try {
    for(const m of marcadas){
      progresso(`Gerando a imagem da página ${m.n} (${feitas + 1} de ${marcadas.length})…`);
      const img = await ppjGerarImagens({ ...envio.fonte, pagina: m.n }, m.giro);
      if(!documentoId){
        progresso("Guardando o arquivo original…");
        docNovo = await ppjGuardarOriginal(obraId, envio);
        documentoId = docNovo.id;
      }
      progresso(`Enviando a página ${m.n} (${feitas + 1} de ${marcadas.length})…`);
      const caminhos = ppjCaminhoImagens(obraId, crypto.randomUUID(), img.ext);
      if(!caminhos) throw new Error("caminho inválido");
      const subidos = [];
      try {
        for(const [caminho, blob] of [[caminhos.alta, img.alta], [caminhos.media, img.media]]){
          const up = await bucket.upload(caminho, blob, { cacheControl: "31536000", contentType: blob.type, upsert: false });
          if(up.error) throw up.error;
          subidos.push(caminho);
        }
        const ins = await ppjInserirFolha({ obra_id: obraId, documento_id: documentoId, pagina: envio.fonte.tipo === "pdf" ? m.n : 1, titulo: m.titulo,
          local: m.local, revisao: m.revisao, imagem_alta_path: caminhos.alta, imagem_media_path: caminhos.media, largura_px: img.largura, altura_px: img.altura,
          ordem: ordem++ }, img.rotacao);
        if(ins.error) throw ins.error;
        _ppj.folhas = (_ppj.folhas || []).concat(ins.data);
        feitas++;
      } catch(e){
        if(subidos.length) await bucket.remove(subidos);   // não deixa imagem sem folha
        throw e;
      }
    }
    progresso("");
    aviso("app-aviso", feitas === 1 ? "Folha do projeto guardada." : `${feitas} folhas do projeto guardadas.`, "ok");
    envio.ocupado = false;
    _ppj.lidoEm = Date.now();
    ppjFecharJanela();
    ppjRedesenhar();
  } catch(e){
    console.error("Projeto do cliente, envio:", e);
    if(docNovo && !feitas){   // nenhuma folha saiu: o original que subiu agora não fica órfão
      const apagada = await sb.from("obras_documentos").delete().eq("id", docNovo.id).select("id");
      if(!apagada.error && apagada.data && apagada.data.length) await bucket.remove([docNovo.storage_path]);
    }
    progresso("");
    const permissao = typeof ehErroDePermissao === "function" && ehErroDePermissao(e);
    ppjAvisoJanela((permissao ? "Seu cargo não grava folhas do projeto nesta obra." : "Não foi possível gerar a folha: " + ((e && e.message) || e))
      + (feitas ? ` ${feitas} folha(s) anterior(es) ficaram guardadas.` : ""));
    envio.ocupado = false;
    if(botao) botao.disabled = false;
    if(feitas){ _ppj.lidoEm = Date.now(); ppjAtualizarFolhasJanela(); ppjRedesenhar(); }
  }
}
/* Grava a folha com o giro da página (rotacao_graus). Banco sem a coluna (migration ainda não aplicada): o insert é
   repetido sem o campo, e as folhas seguintes já vão sem ele; depois de 5 minutos tenta com o campo outra vez. */
async function ppjInserirFolha(linha, rotacao){
  const comGiro = !(_ppjSemRotacaoEm > 0 && Date.now() - _ppjSemRotacaoEm < PPJ_AUSENTE_MS);
  let ins = await sb.from("obras_plantas").insert(comGiro ? { ...linha, rotacao_graus: ppjRotacaoTotal(rotacao, 0) } : linha).select(PPJ_COLUNAS).single();
  if(ins.error && comGiro && ppjColunaAusente(ins.error, "rotacao_graus")){
    _ppjSemRotacaoEm = Date.now();
    ins = await sb.from("obras_plantas").insert(linha).select(PPJ_COLUNAS).single();
  } else if(!ins.error && comGiro) _ppjSemRotacaoEm = 0;
  return ins;
}
/* o original entra em Documentos da obra, como entra pela aba Documentos: categoria projeto, origem manual, MIME pela
   extensão e corpo em Blob. Se a linha não gravar, o arquivo sai do Storage. */
async function ppjGuardarOriginal(obraId, envio){
  const caminho = ppjCaminhoDocumento(obraId, Date.now(), Math.random().toString(36).slice(2, 8) || "x", envio.info.ext);
  if(!caminho) throw new Error("caminho inválido");
  const corpo = envio.arquivo.type === envio.info.mime ? envio.arquivo : new Blob([envio.arquivo], { type: envio.info.mime });
  const bucket = sb.storage.from(PPJ_BUCKET);
  const up = await bucket.upload(caminho, corpo, { cacheControl: "3600", contentType: envio.info.mime, upsert: false });
  if(up.error) throw up.error;
  const { data: { user } } = await sb.auth.getUser();
  const ins = await sb.from("obras_documentos").insert({ obra_id: obraId, categoria: "projeto", nome: envio.arquivo.name, descricao: "Projeto do cliente (fundo da planta)",
    storage_path: caminho, mime_type: envio.info.mime, tamanho_bytes: envio.arquivo.size, enviado_por: user ? user.id : null, origem: "manual" }).select("id,nome,storage_path").single();
  if(ins.error){ await bucket.remove([caminho]); throw ins.error; }
  return ins.data;
}

/* ---------- cuidar das folhas: cada mudança grava na hora ---------- */
async function ppjGravarCampo(id, campo, valor, el){
  const f = (_ppj.folhas || []).find(x => x.id === id);
  if(!f || !["titulo", "local", "revisao"].includes(campo)) return;
  const novo = String(valor || "").trim() || null;
  if(campo === "titulo" && !novo){ el.value = f.titulo || ""; ppjAvisoJanela("A folha precisa de um título."); return; }
  if((f[campo] || null) === novo) return;
  const r = await sb.from("obras_plantas").update({ [campo]: novo }).eq("id", id).select(PPJ_COLUNAS);
  if(r.error || !r.data || !r.data.length){
    el.value = f[campo] || "";
    ppjAvisoJanela(r.error ? "Não foi possível salvar: " + r.error.message : "Seu cargo não altera folhas do projeto nesta obra.");
    return;
  }
  ppjAvisoJanela("");
  Object.assign(f, r.data[0]);
  ppjRedesenhar();
}
async function ppjAcaoFolha(id, acao, botao){
  const f = (_ppj.folhas || []).find(x => x.id === id);
  if(!f) return;
  if(acao === "baixar") return ppjBaixarOriginal(id);
  ppjAvisoJanela("");
  const recusa = (r) => r.error ? "Não foi possível salvar: " + r.error.message : "Seu cargo não altera folhas do projeto nesta obra.";
  await comBotaoTravado(botao, async () => {
    if(acao === "ativar"){
      const r = await sb.from("obras_plantas").update({ ativa: f.ativa === false }).eq("id", id).select("id,ativa");
      if(r.error || !r.data || !r.data.length){ ppjAvisoJanela(recusa(r)); return; }
      f.ativa = r.data[0].ativa;
    } else if(acao === "subir" || acao === "descer"){
      for(const m of ppjReordenar(_ppj.folhas, id, acao === "subir" ? -1 : 1)){
        const r = await sb.from("obras_plantas").update({ ordem: m.ordem }).eq("id", m.id).select("id,ordem");
        if(r.error || !r.data || !r.data.length){ ppjAvisoJanela(recusa(r)); break; }
        const alvo = _ppj.folhas.find(x => x.id === m.id);
        if(alvo) alvo.ordem = m.ordem;
      }
    } else if(acao === "excluir"){
      if(!confirm(`Excluir a folha "${ppjRotuloFolha(f)}"? As duas imagens dela e a posição das estacas marcadas nela são apagadas. O arquivo original continua nos Documentos da obra.`)) return;
      // a linha sai primeiro: se o banco recusar, as imagens continuam onde estão
      const r = await sb.from("obras_plantas").delete().eq("id", id).select("id");
      if(r.error || !r.data || !r.data.length){ ppjAvisoJanela(r.error ? "Não foi possível excluir: " + r.error.message : "Seu cargo não exclui folhas do projeto nesta obra."); return; }
      await sb.storage.from(PPJ_BUCKET).remove([f.imagem_alta_path, f.imagem_media_path]);
      _ppj.folhas = _ppj.folhas.filter(x => x.id !== id);
      if(_ppj.atual === id) _ppj.atual = null;
    } else return;
    _ppj.lidoEm = Date.now();
    ppjAtualizarFolhasJanela();
    ppjRedesenhar();
  });
}

/* ---------- eventos ---------- */
function ligarPlantaProjeto(){
  if(typeof $ !== "function") return;
  $("ppj-barra")?.addEventListener("click", (ev) => {
    const folha = ev.target.closest("[data-ppj-folha]"), baixar = ev.target.closest("[data-ppj-baixar]");
    if(folha){ _ppj.atual = folha.dataset.ppjFolha || null; _ppj.escolheu = true; ppjRedesenhar(); return; }
    if(baixar) return void ppjBaixarOriginal(baixar.dataset.ppjBaixar);
    if(ev.target.closest("[data-ppj-abrir]")) ppjAbrirJanela();
  });
  $("ppj-visor")?.addEventListener("click", (ev) => {
    if(!ev.target.closest("#btn-ppj-alta")) return;
    const f = ppjFolhaAtual();
    if(f){ _ppj.pediuAlta = true; ppjCarregarImagem(f, "alta"); ppjAplicarVisor(); }
  });
  document.addEventListener("fullscreenchange", () => ppjAplicarVisor());
  $("btn-ppj-fechar")?.addEventListener("click", ppjFecharJanela);
  document.addEventListener("keydown", (ev) => { if(ev.key === "Escape" && $("ppj-modal") && $("ppj-modal").style.display !== "none") ppjFecharJanela(); });
  const corpo = $("ppj-corpo");
  if(!corpo) return;
  corpo.addEventListener("change", (ev) => {
    const el = ev.target;
    if(el.id === "ppj-arquivo"){ if(el.files && el.files[0]) ppjAbrirArquivo(el.files[0]); return; }
    const linha = el.closest("[data-ppj-id]");
    if(linha && el.dataset.ppjEdita) ppjGravarCampo(linha.dataset.ppjId, el.dataset.ppjEdita, el.value, el);
  });
  corpo.addEventListener("click", (ev) => {
    const el = ev.target;
    if(el.closest("#btn-ppj-guardado")) return void ppjAbrirGuardado();
    if(el.closest("#btn-ppj-gerar")) return void ppjGerar();
    if(el.closest("#btn-ppj-quais")){
      const r = ppjPaginasPedidas($("ppj-quais")?.value, _ppjEnvio ? _ppjEnvio.total : 0, PPJ_MAX_MINIATURAS);
      if(r.erro){ ppjAvisoJanela(r.erro); return; }
      ppjAvisoJanela("");
      return void ppjMostrarPaginas(r.paginas);
    }
    const girar = el.closest("[data-ppj-girar]");
    if(girar && _ppjEnvio){
      const p = _ppjEnvio.paginas.find(x => x.n === Number(girar.dataset.ppjGirar));
      if(p){ p.giro = (p.giro + 90) % 360; ppjMiniatura(p.n); }
      return;
    }
    const acao = el.closest("[data-ppj-acao]"), linha = el.closest("[data-ppj-id]");
    if(acao && linha) ppjAcaoFolha(linha.dataset.ppjId, acao.dataset.ppjAcao, acao);
  });
}

if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarPlantaProjeto);
  else ligarPlantaProjeto();
}

// teste em Node (scripts/testar-fase167a.mjs e testar-fase167b.mjs): as funções puras também saem por module.exports.
// js/planta_posicoes.js, carregado depois, acrescenta as dele ao mesmo objeto.
if(typeof module === "object" && module && module.exports){
  module.exports = { PPJ_BUCKET, PPJ_PDFJS, PPJ_PDFJS_WORKER, PPJ_TAM_MAX, PPJ_LADO_ALTA, PPJ_LADO_ALTA_REDUZIDA, PPJ_LADO_MEDIA, PPJ_ZOOM_MAX, PPJ_MAX_MINIATURAS,
    PPJ_URL_SEGUNDOS, PPJ_CARGOS_EDITAM, PPJ_COLUNAS, PPJ_VAZIO, PPJ_VAZIO_EDITA, PPJ_VAZIO_LE, PPJ_NOTA_FOLHA, PPJ_NOTA_SEM_ESTACAS, PPJ_AUSENTE_MS, PPJ_VALIDADE_MS,
    ppjPodeEditarCargo, ppjValidarArquivo, ppjCaminhoImagens, ppjCaminhoDocumento, ppjDimensoes, ppjPaginasPedidas, ppjLocaisDaObra, ppjFolhasVisiveis,
    ppjRotuloFolha, ppjProximaOrdem, ppjReordenar, ppjAjustar, ppjLimitar, ppjZoom, ppjArrastar, ppjPinca, ppjEscolherImagem, ppjLarguraMedia,
    ppjTabelaAusente, ppjUrlVale, ppjBarraHTML, ppjFolhasHTML, ppjRotacaoTotal, ppjColunaAusente };
}

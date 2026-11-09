/* ====================================================================
   CGL Fundações — app do operador (fase 129b, spec docs/specs/fase-129-diario-operador.md)
   op_core.js — cliente Supabase, sessão, fila no aparelho (IndexedDB), drenagem e navegação.
   Carregado pelo operador.html antes dos outros js/op_*.js; op_init.js roda por último.
   O core.js do painel não entra aqui (registra listeners do index na carga): a sessão e o login por CPF
   são cópia das funções de mesmo nome do core.js (fases 87 e 93b), como a spec permite (seção 4.1).
   Regras: o campo grava só pelas RPCs rdo_campo_* (fase 129a); toda gravação vai para a fila e sobe em
   ordem; a rejeição do banco fica visível por linha; Sair e sessão vencida nunca apagam a fila.
   ==================================================================== */

const SUPABASE_URL = "https://xiirduialyewpqkwsfxx.supabase.co";
const SUPABASE_KEY = "sb_publishable_uef7GgPhtV5SSp-281PtNA_fD3ajHN4";

/* ---------- Sessão (cópia de core.js, fase 87): sessionStorage, ou localStorage com "Manter conectado" ---------- */
const SESSAO_LEMBRAR_CHAVE = "cgl_lembrar";
function lembrarLer(){
  try {
    const r = JSON.parse(localStorage.getItem(SESSAO_LEMBRAR_CHAVE) || "null");
    if(r && r.ate && Date.now() < r.ate) return r;
    if(r) localStorage.removeItem(SESSAO_LEMBRAR_CHAVE);
  } catch(_){}
  return null;
}
function lembrarAtivo(){ return !!lembrarLer(); }
function lembrarGravar(dias){
  try {
    const d = Number(dias) > 0 ? Number(dias) : 7;
    localStorage.setItem(SESSAO_LEMBRAR_CHAVE, JSON.stringify({ desde: Date.now(), ate: Date.now() + d * 86400000 }));
  } catch(_){}
}
function lembrarApagar(){ try { localStorage.removeItem(SESSAO_LEMBRAR_CHAVE); } catch(_){} }
const sessaoStorage = {
  getItem(k){
    try {
      if(lembrarAtivo()) return localStorage.getItem(k);
      if(localStorage.getItem(k) != null) localStorage.removeItem(k);
      return sessionStorage.getItem(k);
    } catch(_){ return null; }
  },
  setItem(k, v){ try { (lembrarAtivo() ? localStorage : sessionStorage).setItem(k, v); } catch(_){} },
  removeItem(k){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch(_){} }
};
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: sessaoStorage } });

/* ---------- Login por CPF (cópia de core.js, fase 93b): o e-mail técnico nunca vai para a tela ---------- */
const LOGIN_CPF_DOMINIO = "funcionarios.cglfundacoes.com.br";
function loginPareceCpf(v){
  const s = String(v || "").trim();
  return /^[\d.\-\s]+$/.test(s) && s.replace(/\D/g, "").length === 11;
}
function loginParaEmail(v){
  const s = String(v || "").trim();
  return loginPareceCpf(s) ? s.replace(/\D/g, "") + "@" + LOGIN_CPF_DOMINIO : s;
}
function emailEhLoginCpf(email){ return String(email || "").toLowerCase().endsWith("@" + LOGIN_CPF_DOMINIO); }

/* ---------- Ajudantes ---------- */
const $ = (id) => document.getElementById(id);
function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(v, casas = 2){
  const n = Number(v);
  if(v === null || v === undefined || v === "" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
function dataBR(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
function dataLocalISO(d = new Date()){
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDiasISO(iso, dias){
  const [a, m, d] = iso.split("-").map(Number);
  return dataLocalISO(new Date(a, m - 1, d + dias));
}
function horaAgora(passoMin = 1){
  const d = new Date();
  let min = d.getHours() * 60 + d.getMinutes();
  min = Math.round(min / passoMin) * passoMin;
  if(min >= 1440) min = 1439;
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}
function hhmm(v){ return v ? String(v).slice(0, 5) : ""; }
function horaDeTimestamp(iso){
  if(!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function minutos(h){ const m = /^(\d{1,2}):(\d{2})/.exec(String(h || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function novoId(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function avisar(msg, tipo = "info"){
  const t = $("op-toast");
  if(!t) return;
  t.textContent = msg;
  t.className = "op-toast op-toast-" + tipo;
  t.hidden = false;
  clearTimeout(avisar._t);
  avisar._t = setTimeout(() => { t.hidden = true; }, tipo === "erro" ? 7000 : 3500);
}
function prefLer(k, padrao = null){ try { const v = localStorage.getItem("cgl_op_" + k); return v == null ? padrao : v; } catch(_){ return padrao; } }
function prefGravar(k, v){ try { if(v == null) localStorage.removeItem("cgl_op_" + k); else localStorage.setItem("cgl_op_" + k, String(v)); } catch(_){} }

const ROTULO_TIPO = { helice_continua: "Hélice contínua", helice_secante: "Hélice secante", estaca_raiz: "Estaca raiz", trado_mecanizado: "Trado mecanizado" };
const ROTULO_TEMPO = { bom: "Bom", nublado: "Nublado", chuva_fraca: "Chuva fraca", chuva_forte: "Chuva forte", impraticavel: "Impraticável" };
const ROTULO_STATUS_DIA = { falta: "Falta", folga: "Folga", folga_meio_periodo: "Folga meio período", dsr: "DSR", atestado: "Atestado",
  em_treinamento: "Treinamento", em_viagem: "Em viagem", viagem_retorno_casa: "Viagem de volta para casa", manutencao: "Manutenção",
  noturno: "Noturno", revisar_informacao: "Revisar informação" };
const ROTULO_FUNCAO = { operador: "Operador", ajudante: "Ajudante", encarregado: "Encarregado", sondador: "Sondador", motorista: "Motorista",
  soldador: "Soldador", apontador: "Apontador", tecnico: "Técnico", engenheiro: "Engenheiro", seguranca: "Segurança", terceirizado: "Terceirizado", outro: "Outro" };
const CARGOS_CAMPO = ["operador", "encarregado", "engenheiro", "assistente_engenharia", "admin", "diretor"];
const ehRaizOuTrado = (t) => t === "estaca_raiz" || t === "trado_mecanizado";

/* ---------- Estado ---------- */
const OP = {
  perfil: null,        // { id, nome, cargo, funcionario_id, senha_provisoria }
  funcionario: null,   // { nome, funcao } da CTPS, pela vw_funcionarios_campo
  cpfDigitos: null,
  db: null,
  rdoId: null,         // diário aberto
  snap: null,          // snapshot do diário aberto (rdo_campo_snapshot)
  snapVistoEm: null,
  difRelogioMin: 0,
  drenando: false,
  pausadoSessao: false,
  forcarFotos: false,
  ultimaSync: null,
  telaAtual: null,
  telas: {}            // nome -> função de render, registradas pelos módulos
};

/* ====================================================================
   IndexedDB: um banco por profile_id, com 4 stores (seção 4.3)
   dia (snapshot por rdo_id) · cache (listas de apoio) · outbox (fila, em ordem) · fotos (Blob reduzido)
   ==================================================================== */
function idbAbrir(profileId){
  return new Promise((ok, falha) => {
    const r = indexedDB.open("cgl-campo-" + profileId, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if(!db.objectStoreNames.contains("dia")) db.createObjectStore("dia", { keyPath: "rdo_id" });
      if(!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "chave" });
      if(!db.objectStoreNames.contains("outbox")) {
        const s = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        s.createIndex("op_id", "op_id", { unique: true });
      }
      if(!db.objectStoreNames.contains("fotos")) db.createObjectStore("fotos", { keyPath: "id" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
function idbReq(store, modo, fn){
  return new Promise((ok, falha) => {
    if(!OP.db){ falha(new Error("Fila do aparelho não aberta.")); return; }
    const tx = OP.db.transaction(store, modo);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => ok(r && "result" in r ? r.result : undefined);
    tx.onerror = () => falha(tx.error);
    tx.onabort = () => falha(tx.error);
  });
}
const idbGet = (store, chave) => idbReq(store, "readonly", s => s.get(chave));
const idbPut = (store, valor) => idbReq(store, "readwrite", s => s.put(valor));
const idbDel = (store, chave) => idbReq(store, "readwrite", s => s.delete(chave));
const idbTodos = (store) => idbReq(store, "readonly", s => s.getAll());
const idbLimpar = (store) => idbReq(store, "readwrite", s => s.clear());

/* contagem da fila antes do login (faixa da tela Entrar): o último perfil que usou o aparelho */
async function contarFilaDoAparelho(){
  const id = prefLer("ultimo_perfil");
  if(!id || !window.indexedDB) return { registros: 0, fotos: 0 };
  try {
    const db = await idbAbrir(id);
    const fila = await new Promise((ok) => {
      const tx = db.transaction("outbox", "readonly");
      const r = tx.objectStore("outbox").getAll();
      r.onsuccess = () => ok(r.result || []);
      r.onerror = () => ok([]);
    });
    db.close();
    return { registros: fila.filter(o => o.rpc !== "upload_foto").length, fotos: fila.filter(o => o.rpc === "upload_foto").length };
  } catch(_){ return { registros: 0, fotos: 0 }; }
}

/* decisão A (09/11/2026): a fila vive até campo_fila_max_dias; passou disso, sai ao abrir a página, com o aviso */
async function limparFilaVencida(){
  const maxDias = Number(prefLer("fila_max_dias", "30")) || 30;
  const limite = Date.now() - maxDias * 86400000;
  const fila = await idbTodos("outbox");
  let n = 0;
  for(const o of fila){
    if(Date.parse(o.criado_em) < limite){
      await idbDel("outbox", o.seq);
      if(o.rpc === "upload_foto" && o.args?.foto_id) await idbDel("fotos", o.args.foto_id);
      n++;
    }
  }
  return n;
}

/* ====================================================================
   Fila (outbox) e drenagem em ordem (seção 4.3)
   ==================================================================== */
async function lerFila(){
  const fila = await idbTodos("outbox");
  return fila.sort((a, b) => a.seq - b.seq);
}

/* rpc + args; meta: { rotulo, linha_id }. p_op é o op_id (idempotência em campo_ops) */
async function enfileirar(rpc, args, meta = {}){
  const opId = args.p_op || novoId();
  if("p_op" in args || rpc.startsWith("rdo_campo_")) args.p_op = opId;
  if(rpc.startsWith("rdo_campo_") && !("p_em_aparelho" in args)) args.p_em_aparelho = new Date().toISOString();
  await idbPut("outbox", {
    op_id: opId, rpc, args, rdo_id: args.p_rdo || OP.rdoId, linha_id: meta.linha_id || args.p_id || null,
    rotulo: meta.rotulo || rpc, criado_em: new Date().toISOString(), tentativas: 0, situacao: "pendente", erro: null
  });
  if(OP.snap) await idbPut("dia", { rdo_id: OP.rdoId, snap: OP.snap, visto_em: OP.snapVistoEm });
  agendarDrenagem(10000);
  await atualizarFaixaFila();   // a tela que redesenha logo depois já mostra o selo "no aparelho"
  return opId;
}

let _drenagemTimer = null;
function agendarDrenagem(ms = 0){
  clearTimeout(_drenagemTimer);
  _drenagemTimer = setTimeout(() => { drenar(); }, ms);
}

function ehErroDeRede(err){
  if(!err) return false;
  const m = String(err.message || err).toLowerCase();
  return err.name === "TypeError" || m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") || m.includes("network request failed");
}
function ehErroDeSessao(err, status){
  const c = String(err?.code || "");
  return status === 401 || c === "PGRST301" || c === "PGRST303" || /jwt|token.*expired/i.test(String(err?.message || ""));
}
function mensagemDoBanco(err){
  const m = String(err?.message || err || "erro").replace(/\s+/g, " ").trim();
  return m.length > 200 ? m.slice(0, 200) + "…" : m;
}

async function drenar(){
  if(OP.drenando || !OP.db || OP.pausadoSessao) return;
  if(!navigator.onLine){ atualizarFaixaFila(); return; }
  OP.drenando = true;
  atualizarFaixaFila();
  let aplicadas = 0;
  const rdosTocados = new Set();
  try {
    const fila = await lerFila();
    const travados = new Set();   // diários com operação recusada ou em conflito antes do envio
    for(const o of fila){
      if(o.situacao === "rejeitada" || o.situacao === "conflito"){ travados.add(o.rdo_id); continue; }
      if(o.situacao !== "pendente") continue;
      if(o.rpc === "rdo_campo_enviar" && travados.has(o.rdo_id)){
        o.situacao = "rejeitada";
        o.erro = "Há registro recusado deste dia antes do envio: resolva em Eu › Pendências e envie de novo.";
        await idbPut("outbox", o);
        continue;
      }
      if(o.rpc === "upload_foto"){
        const r = await enviarFoto(o);
        if(r === "rede") break;
        if(r === "ok"){ aplicadas++; rdosTocados.add(o.rdo_id); }
        continue;
      }
      o.tentativas = (o.tentativas || 0) + 1;
      let resp;
      try { resp = await sb.rpc(o.rpc, o.args); }
      catch(e){ if(ehErroDeRede(e)) break; resp = { error: e }; }
      const { data, error, status } = resp;
      if(error){
        if(ehErroDeRede(error) || status === 0){ await idbPut("outbox", o); break; }
        if(ehErroDeSessao(error, status)){ OP.pausadoSessao = true; await idbPut("outbox", o); pedirSenhaDeNovo(); break; }
        o.situacao = "rejeitada";
        o.erro = mensagemDoBanco(error);
        travados.add(o.rdo_id);
        await idbPut("outbox", o);
        continue;
      }
      if(data && data.situacao === "conflito"){
        o.situacao = "conflito";
        o.erro = "Outra pessoa mudou " + (data.campos || []).join(", ") + " depois que você viu.";
        o.servidor = data.servidor || {};
        travados.add(o.rdo_id);
        await idbPut("outbox", o);
        continue;
      }
      if(data && data.ok === false){
        o.situacao = "rejeitada";
        o.erro = data.mensagem || "Recusado pelo banco.";
        travados.add(o.rdo_id);
        await idbPut("outbox", o);
        continue;
      }
      await idbDel("outbox", o.seq);   // confirmada: sai do aparelho (seção 4.7)
      aplicadas++;
      rdosTocados.add(o.rdo_id);
    }
  } finally {
    OP.drenando = false;
  }
  if(aplicadas) OP.ultimaSync = new Date();
  // o diário aberto volta do banco quando não sobrou nada pendente dele no aparelho
  if(OP.rdoId && rdosTocados.has(OP.rdoId)){
    const resta = (await lerFila()).some(o => o.rdo_id === OP.rdoId && o.situacao === "pendente" && o.rpc !== "upload_foto");
    if(!resta) await recarregarDia(true);
  }
  atualizarFaixaFila();
  renderTelaAtual();
}

/* fotos: depois dos dados, com teto diário de MB (plano de dados do operador) */
function fotosEnviadasHojeMB(){
  const r = String(prefLer("fotos_mb_dia", "") || "").split("|");
  return r[0] === dataLocalISO() ? Number(r[1]) || 0 : 0;
}
function somarFotosHojeMB(mb){ prefGravar("fotos_mb_dia", dataLocalISO() + "|" + (fotosEnviadasHojeMB() + mb).toFixed(2)); }
async function enviarFoto(o){
  const foto = await idbGet("fotos", o.args.foto_id);
  if(!foto){ await idbDel("outbox", o.seq); return "ok"; }
  const tetoMB = Number(OP.snap?.config?.fotos_auto_mb || prefLer("fotos_auto_mb", "20")) || 20;
  const mb = (foto.blob?.size || 0) / 1048576;
  if(!OP.forcarFotos && fotosEnviadasHojeMB() + mb > tetoMB) return "adiada";
  // o registro da foto (rdo_campo_foto_registrar) tem de ter subido antes: ele está antes na fila
  const regPendente = (await lerFila()).some(x => x.rpc === "rdo_campo_foto_registrar" && x.args?.p_id === o.args.foto_id);
  if(regPendente) return "adiada";
  // regra de uploads do projeto: o MIME vai no Blob reembalado, nunca pelo File
  const corpo = new Blob([await foto.blob.arrayBuffer()], { type: "image/jpeg" });
  let up;
  try { up = await sb.storage.from("rdo-fotos").upload(o.args.path, corpo, { contentType: "image/jpeg", upsert: false }); }
  catch(e){ return ehErroDeRede(e) ? "rede" : "adiada"; }
  if(up.error && !/exists|duplicate/i.test(up.error.message || "")){
    if(ehErroDeRede(up.error)) return "rede";
    o.situacao = "rejeitada"; o.erro = "Foto: " + mensagemDoBanco(up.error); await idbPut("outbox", o); return "rejeitada";
  }
  const { error } = await sb.rpc("rdo_campo_foto_confirmar", { p_id: o.args.foto_id });
  if(error){
    if(ehErroDeRede(error)) return "rede";
    o.situacao = "rejeitada"; o.erro = "Foto: " + mensagemDoBanco(error); await idbPut("outbox", o); return "rejeitada";
  }
  somarFotosHojeMB(mb);
  await idbDel("outbox", o.seq);
  await idbDel("fotos", o.args.foto_id);
  return "ok";
}

/* situação de uma linha da tela pela fila: pendente, rejeitada (com motivo) ou conflito */
let _filaCache = [];
async function atualizarFaixaFila(){
  if(!OP.db) return;
  _filaCache = await lerFila();
  const dados = _filaCache.filter(o => o.rpc !== "upload_foto" && o.situacao === "pendente").length;
  const fotos = _filaCache.filter(o => o.rpc === "upload_foto" && o.situacao === "pendente").length;
  const ruins = _filaCache.filter(o => o.situacao === "rejeitada" || o.situacao === "conflito").length;
  const f = $("op-faixa-fila");
  if(!f) return;
  if(!dados && !fotos && !ruins){ f.hidden = true; return; }
  const partes = [];
  if(dados) partes.push(`${dados} ${dados === 1 ? "registro" : "registros"}`);
  if(fotos) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
  let txt = partes.length ? "⏳ " + partes.join(" e ") + " aguardando envio" : "";
  if(ruins) txt += (txt ? " · " : "") + `⚠ ${ruins} recusado${ruins === 1 ? "" : "s"}: veja em Eu › Pendências`;
  if(!navigator.onLine) txt += " · sem sinal";
  else if(OP.drenando) txt += " · enviando…";
  f.textContent = txt;
  f.className = "op-faixa " + (ruins ? "op-faixa-perigo" : "op-faixa-aviso");
  f.hidden = false;
}
function estadoDaLinha(id){
  if(!id) return null;
  const ops = _filaCache.filter(o => o.linha_id === id || o.args?.p_id === id);
  const ruim = ops.find(o => o.situacao === "rejeitada" || o.situacao === "conflito");
  if(ruim) return { tipo: "recusado", texto: "recusado: " + (ruim.erro || "veja em Eu › Pendências") };
  if(ops.some(o => o.situacao === "pendente")) return { tipo: "aparelho", texto: "no aparelho" };
  return null;
}
/* rótulo de estado com ícone (nunca só cor) */
function seloEstado(id, linha){
  const e = estadoDaLinha(id);
  if(e && e.tipo === "recusado") return `<span class="op-selo op-selo-perigo">⚠ ${esc(e.texto)}</span>`;
  if(e) return `<span class="op-selo op-selo-aviso">⏳ ${esc(e.texto)}</span>`;
  if(linha && linha.liberado) return `<span class="op-selo">🔒 liberada para a folha</span>`;
  return `<span class="op-selo op-selo-ok">✓ enviado</span>`;
}
function filaTemPendenteDoDia(){ return _filaCache.some(o => o.rdo_id === OP.rdoId && o.situacao === "pendente" && o.rpc !== "upload_foto"); }
function filaVazia(){ return !_filaCache.length; }

/* valores que o aparelho viu antes de mudar (p_anteriores): o banco só acusa conflito se mudou de lá para cá */
function anteriores(linha, campos){
  if(!linha) return null;
  const r = {};
  for(const k of Object.keys(campos)) if(k in linha) r[k] = linha[k];
  return Object.keys(r).length ? r : null;
}

/* ====================================================================
   Diário aberto: snapshot no aparelho
   ==================================================================== */
async function guardarSnapshot(snap){
  OP.snap = snap;
  OP.rdoId = snap?.rdo?.id || null;
  OP.snapVistoEm = new Date().toISOString();
  if(snap?.servidor_agora) OP.difRelogioMin = Math.round((Date.now() - Date.parse(snap.servidor_agora)) / 60000);
  if(snap?.config){
    prefGravar("fila_max_dias", snap.config.fila_max_dias);
    prefGravar("fotos_auto_mb", snap.config.fotos_auto_mb);
  }
  if(OP.rdoId){
    prefGravar("rdo_atual", OP.rdoId);
    await idbPut("dia", { rdo_id: OP.rdoId, snap, visto_em: OP.snapVistoEm });
  }
}
async function recarregarDia(silencioso = false){
  if(!OP.rdoId) return false;
  if(!navigator.onLine){ if(!silencioso) avisar("Sem sinal: mostrando o que está no aparelho.", "aviso"); return false; }
  const { data, error } = await sb.rpc("rdo_campo_snapshot", { p_rdo: OP.rdoId });
  if(error){
    if(ehErroDeSessao(error)){ pedirSenhaDeNovo(); return false; }
    if(!silencioso) avisar(mensagemDoBanco(error), "erro");
    return false;
  }
  await guardarSnapshot(data);
  return true;
}
async function carregarDiaDoAparelho(rdoId){
  const r = await idbGet("dia", rdoId);
  if(!r) return false;
  OP.snap = r.snap; OP.rdoId = rdoId; OP.snapVistoEm = r.visto_em;
  return true;
}
function diaEditavel(){
  return !!OP.snap?.rdo?.pode_editar && !_filaCache.some(o => o.rdo_id === OP.rdoId && o.rpc === "rdo_campo_enviar" && o.situacao === "pendente");
}
function paradaAberta(){ return (OP.snap?.paradas || []).find(p => p.periodo_inicio && !p.periodo_fim) || null; }

/* ====================================================================
   Navegação: uma <section class="op-tela"> por tela, barra inferior por tipo de serviço (seção 5)
   ==================================================================== */
const TITULOS = { maquina: "Minha máquina", dia: "Meu dia", equipe: "Equipe do dia", abast: "Abastecimento e horímetro",
  estacas: "Estacas do dia", geo: "Estacas de hoje", parada: "Paradas", foto: "Fotos", enviar: "Enviar o dia",
  dias: "Meus dias", eu: "Eu", mais: "Mais" };
function irPara(tela){
  if(tela !== "maquina" && tela !== "dias" && tela !== "eu" && tela !== "mais" && !OP.snap){ tela = "maquina"; }
  OP.telaAtual = tela;
  document.querySelectorAll(".op-tela").forEach(s => { s.hidden = s.id !== "op-" + tela; });
  if($("op-titulo")) $("op-titulo").textContent = TITULOS[tela] || "";
  montarBarra();
  renderTelaAtual();
  window.scrollTo(0, 0);
}
function renderTelaAtual(){
  const fn = OP.telas[OP.telaAtual];
  if(fn) Promise.resolve(fn()).catch(e => { console.error(e); avisar("Erro na tela: " + mensagemDoBanco(e), "erro"); });
  montarCabecalho();
}
function montarBarra(){
  const nav = $("op-barra");
  if(!nav) return;
  const tipo = OP.snap?.rdo?.tipo_servico;
  const itens = !OP.snap ? [["maquina", "🚜", "Máquina"], ["dias", "📅", "Meus dias"], ["eu", "👤", "Eu"]]
    : ehRaizOuTrado(tipo) ? [["dia", "📋", "Dia"], ["estacas", "📍", "Estacas"], ["parada", "⏸", "Paradas"], ["mais", "☰", "Mais"]]
    : [["dia", "📋", "Dia"], ["parada", "⏸", "Paradas"], ["equipe", "👷", "Equipe"], ["mais", "☰", "Mais"]];
  nav.innerHTML = itens.map(([t, ic, rot]) =>
    `<button type="button" class="op-barra-item${t === OP.telaAtual ? " ativo" : ""}" data-ir="${esc(t)}"><span aria-hidden="true">${esc(ic)}</span><span>${esc(rot)}</span></button>`).join("");
  const fab = $("op-fab-parada");
  if(fab) fab.hidden = !OP.snap || OP.telaAtual === "parada" || !diaEditavel();
}
function montarCabecalho(){
  const s = OP.snap;
  const sub = $("op-subtitulo");
  if(!sub) return;
  sub.textContent = s ? `${s.equipamento?.codigo || "sem máquina"} · ${s.obra?.codigo || ""} · ${dataBR(s.rdo?.data)}${s.rdo?.turno_campo === "noturno" ? " · noturno" : ""}` : (OP.perfil?.nome || "");
}

/* ====================================================================
   Sessão: entrar, troca da senha provisória, pedir senha de novo, sair
   ==================================================================== */
async function lerPerfil(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) return null;
  OP.cpfDigitos = emailEhLoginCpf(user.email) ? String(user.email).split("@")[0] : null;
  const { data: perfil, error } = await sb.from("profiles").select("id,nome,cargo,ativo,funcionario_id,senha_provisoria").eq("id", user.id).single();
  if(error || !perfil) return { id: user.id, nome: "Funcionário", cargo: null, ativo: false };
  return perfil;
}
async function lerFuncionario(){
  OP.funcionario = null;
  if(!OP.perfil?.funcionario_id) return;
  const { data } = await sb.from("vw_funcionarios_campo").select("id,nome,funcao").eq("id", OP.perfil.funcionario_id).limit(1);
  if(data && data[0]) OP.funcionario = data[0];
}

function pedirSenhaDeNovo(){
  OP.pausadoSessao = true;
  const d = $("op-sessao-vencida");
  if(d) d.hidden = false;
  atualizarFaixaFila();
}

/* Sair: apaga o diário e as listas guardadas e o CPF lembrado; a fila fica (seção 4.7) */
async function sair(){
  const fila = OP.db ? await lerFila() : [];
  if(fila.length && !confirm(`Há ${fila.length} registro(s) no aparelho ainda não enviados. Eles ficam guardados e sobem no próximo acesso. Sair mesmo assim?`)) return;
  try { if(OP.db){ await idbLimpar("dia"); await idbLimpar("cache"); } } catch(_){}
  prefGravar("cpf", null);
  prefGravar("rdo_atual", null);
  lembrarApagar();
  await sb.auth.signOut();
  location.replace("operador.html");
}

/* ====================================================================
   Versão (fase 86): recarrega sozinho só com a fila vazia e sem parada aberta
   ==================================================================== */
function versaoAtual(){ return document.querySelector('meta[name="app-versao"]')?.content || "dev"; }
async function conferirVersao(){
  if(versaoAtual() === "dev" || !navigator.onLine) return;
  try {
    const r = await fetch("versao.json?ts=" + Date.now(), { cache: "no-store" });
    if(!r.ok) return;
    const j = await r.json();
    if(j?.versao && j.versao !== versaoAtual()){
      await atualizarFaixaFila();
      if(filaVazia() && !paradaAberta()) location.reload();
    }
  } catch(_){}
}

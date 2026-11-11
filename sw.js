/* Fase 129b: service worker do app do operador (escopo ./operador, nunca controla o index.html).
   VERSAO é carimbada pelo scripts/publicar-app.sh; cada publicação abre um cache novo e apaga os antigos.
   Rede primeiro (com prazo curto, o sinal da obra é fraco) e o cache como reserva: o app abre sem sinal
   com o que ficou da última vez. Supabase e fontes são de outra origem e não passam por aqui. */
const VERSAO = "dc4900e";
const CACHE = "cgl-campo-" + VERSAO;
const ARQUIVOS = [
  "operador.html", "manifest.webmanifest", "css/estilo.css", "js/tema.js", "vendor/supabase-js-2.118.0.min.js",
  "js/op_core.js", "js/op_dia.js", "js/op_equipe.js", "js/op_estacas.js", "js/op_parada.js", "js/op_foto.js", "js/op_init.js",
  "img/icone-cgl.png", "img/logo-cgl.png"
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS.map(a => new Request(a, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k.startsWith("cgl-campo-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function comPrazo(promessa, ms){
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error("prazo")), ms);
    promessa.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); falha(e); });
  });
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  // versao.json: sempre da rede (é ele que avisa da publicação nova)
  if(url.pathname.endsWith("/versao.json")) return;
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resp = await comPrazo(fetch(req), 5000);
      if(resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    } catch(_){
      // o HTML carimba ?v=<commit>: sem sinal, vale o arquivo guardado com ou sem o carimbo
      const guardado = await cache.match(req) || await cache.match(req, { ignoreSearch: true });
      if(guardado) return guardado;
      throw _;
    }
  })());
});

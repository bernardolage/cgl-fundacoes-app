



const VERSAO = "f425e2e";
const CACHE = "cgl-campo-" + VERSAO;
const ARQUIVOS = [
  "operador.html", "manifest.webmanifest", "css/estilo.css", "js/tema.js", "vendor/supabase-js-2.118.0.min.js",
  "js/op_core.js", "js/ui.js", "js/op_dia.js", "js/op_equipe.js", "js/op_estacas.js", "js/op_parada.js", "js/op_foto.js", "js/op_init.js",
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

  if(url.pathname.endsWith("/versao.json")) return;
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resp = await comPrazo(fetch(req), 5000);
      if(resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    } catch(_){

      const guardado = await cache.match(req) || await cache.match(req, { ignoreSearch: true });
      if(guardado) return guardado;
      throw _;
    }
  })());
});

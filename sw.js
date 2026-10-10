// Guarda la web en el móvil para poder usarla sin conexión.
// Al añadir preguntas, sube el número de versión para que se actualice.
const CACHE = "tests-v2";
const FILES = ["./", "index.html", "manifest.json", "icon-180.png", "icon-192.png", "data/biblioteca-dfb.js", "data/getxo-administrativo.js", "data/abanto-administrativo.js", "data/getxo-kirolak-auxiliar.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Primero intenta la red (para tener siempre lo último); si no hay conexión, usa la copia guardada.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && new URL(e.request.url).origin === location.origin) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request)));
});

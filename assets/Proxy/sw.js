/* TACTICS - V2 Proxy service worker.
 * Browsers only allow a service worker to be served from the same origin as the
 * page that registers it, so this tiny file (plus frame.html and
 * baremux-worker.js) has to be hosted on a real origin (https://prox.site.je/Proxy/).
 * Everything else is pulled from jsDelivr.
 */
const SJ_CDN = 'https://cdn.jsdelivr.net/npm/@mercuryworkshop/scramjet@1.1.0/dist/';
importScripts(SJ_CDN + 'scramjet.all.js');

// Scramjet treats config.files.wasm as a same-origin path. That path doesn't exist on
// the host, so any fetch the worker makes for it is redirected to the jsDelivr copy.
const WASM_PATH = new URL('./scramjet.wasm.wasm', self.location.href).pathname;
const nativeFetch = self.fetch.bind(self);
self.fetch = function(input, init){
  try{
    const u = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    if(new URL(u, self.location.href).pathname === WASM_PATH) return nativeFetch(SJ_CDN + 'scramjet.wasm.wasm');
  }catch(e){}
  return nativeFetch(input, init);
};

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', (e)=> e.waitUntil(self.clients.claim()));

async function handleRequest(event){
  await scramjet.loadConfig();
  if(scramjet.route(event)) return scramjet.fetch(event);
  // Requests outside the proxy (e.g. a blocked cross-site favicon) just fail like normal.
  return nativeFetch(event.request).catch(()=> Response.error());
}

self.addEventListener('fetch', (event)=>{
  event.respondWith(handleRequest(event));
});

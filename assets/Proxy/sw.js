/* TACTICS - V2 Proxy service worker.
 * Browsers only allow a service worker to be served from the same origin as the
 * page that registers it, so this tiny file (plus frame.html and
 * baremux-worker.js) has to be hosted on a real origin (the Proxy Host).
 * Everything else is pulled from jsDelivr.
 *
 * It serves all four proxy engines frame.html can use, each under its own prefix:
 *   scramjet/  Scramjet 1.1      service/  Ultraviolet
 *   uv/        Interstellar      ~/sj/     Scramjet 2 (via scramjet-controller)
 */
const NPM = 'https://cdn.jsdelivr.net/npm/';
const SJ_CDN = NPM + '@mercuryworkshop/scramjet@1.1.0/dist/';
const UV_CDN = NPM + '@titaniumnetwork-dev/ultraviolet@3.2.10/dist/';
importScripts(SJ_CDN + 'scramjet.all.js');
importScripts(UV_CDN + 'uv.bundle.js');
importScripts(UV_CDN + 'uv.sw.js');
importScripts(NPM + '@mercuryworkshop/scramjet-controller@0.0.14/dist/controller.sw.js');

const BASE = new URL('./', self.location.href).pathname;

// Scramjet treats config.files.wasm as a same-origin path. That path doesn't exist on
// the host, so any fetch the worker makes for it is redirected to the jsDelivr copy.
const WASM_PATH = BASE + 'scramjet.wasm.wasm';
const nativeFetch = self.fetch.bind(self);
self.fetch = function(input, init){
  try{
    const u = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    if(new URL(u, self.location.href).pathname === WASM_PATH) return nativeFetch(SJ_CDN + 'scramjet.wasm.wasm');
  }catch(e){}
  return nativeFetch(input, init);
};

// Created on first use: it reads Scramjet 1.1's IndexedDB straight away, and that database only
// exists once a Scramjet 1.1 tab has started.
const { ScramjetServiceWorker } = $scramjetLoadWorker();
let scramjet = null;
function scramjetWorker(){ return scramjet || (scramjet = new ScramjetServiceWorker()); }

/* ---------- Ultraviolet + Interstellar ----------
   Interstellar's proxy is Ultraviolet with its own config (prefix uv/, xor codec). Pages proxied by
   Ultraviolet load a config script by URL, so this worker generates those two scripts itself. */
function uvConfig(prefix, configPath){
  return {
    prefix,
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: UV_CDN + 'uv.handler.js',
    client: UV_CDN + 'uv.client.js',
    bundle: UV_CDN + 'uv.bundle.js',
    config: configPath,
    sw: UV_CDN + 'uv.sw.js'
  };
}
function uvConfigScript(cfg){
  const plain = Object.assign({}, cfg);
  delete plain.encodeUrl; delete plain.decodeUrl;
  return 'self.__uv$config=' + JSON.stringify(plain) + ';' +
         'self.__uv$config.encodeUrl=Ultraviolet.codec.xor.encode;self.__uv$config.decodeUrl=Ultraviolet.codec.xor.decode;';
}
const uvCfg = uvConfig(BASE + 'service/', BASE + 'uv.config.js');
const isCfg = uvConfig(BASE + 'uv/', BASE + 'interstellar.config.js');
self.__uv$config = uvCfg;
// Created on first use: each one starts a bare-mux client, which only Ultraviolet/Interstellar tabs set up.
let uv = null, interstellar = null;

function jsResponse(body){
  return new Response(body, { headers: { 'content-type': 'application/javascript; charset=utf-8' } });
}

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', (e)=> e.waitUntil(self.clients.claim()));

async function handleRequest(event){
  const url = new URL(event.request.url);
  if(url.origin === self.location.origin){
    if(url.pathname === uvCfg.config) return jsResponse(uvConfigScript(uvCfg));
    if(url.pathname === isCfg.config) return jsResponse(uvConfigScript(isCfg));
    if(url.pathname.startsWith(uvCfg.prefix)) return (uv || (uv = new UVServiceWorker(uvCfg))).fetch(event);
    if(url.pathname.startsWith(isCfg.prefix)) return (interstellar || (interstellar = new UVServiceWorker(isCfg))).fetch(event);
  }
  if(self.$scramjetController && $scramjetController.shouldRoute(event)) return $scramjetController.route(event);
  // Scramjet 1.1 keeps its config in IndexedDB, which only exists once a Scramjet 1.1 tab has
  // started, so only ask it about its own paths.
  if(url.origin === self.location.origin && (url.pathname.startsWith(BASE + 'scramjet/') || url.pathname === WASM_PATH)){
    const sj = scramjetWorker();
    await sj.loadConfig();
    if(sj.route(event)) return sj.fetch(event);
  }
  // Requests outside the proxy (e.g. a blocked cross-site favicon) just fail like normal.
  return nativeFetch(event.request).catch(()=> Response.error());
}

self.addEventListener('fetch', (event)=>{
  event.respondWith(handleRequest(event));
});

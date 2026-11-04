/* TACTICS - V2 Proxy service worker.
 * Browsers only allow a service worker to be served from the same origin as the
 * page that registers it, so this tiny file (plus frame.html and
 * baremux-worker.js) has to be hosted on a real origin (the Proxy Host).
 * Everything else is pulled from jsDelivr.
 *
 * It serves all four proxy engines frame.html can use, each under its own prefix:
 *   scramjet/  Scramjet 1.1      service/  Ultraviolet
 *   uv/        Interstellar      ~/sj/     Scramjet 2 and T4CTIC$ (via scramjet-controller)
 * and blocks ads for all of them with uBlock Origin's filtering engine (adblock.js).
 */
const NPM = 'https://cdn.jsdelivr.net/npm/';
const SJ_CDN = NPM + '@mercuryworkshop/scramjet@1.1.0/dist/';
const UV_CDN = NPM + '@titaniumnetwork-dev/ultraviolet@3.2.10/dist/';
importScripts(SJ_CDN + 'scramjet.all.js');
importScripts(UV_CDN + 'uv.bundle.js');
importScripts(UV_CDN + 'uv.sw.js');
importScripts(NPM + '@mercuryworkshop/scramjet-controller@0.0.14/dist/controller.sw.js');
// uBlock Origin's network filtering engine (built from assets/AdBlock). Hosts that don't have the
// file yet get the copy in the GitHub repo through jsDelivr.
try{ importScripts('adblock.js'); }
catch(e){ importScripts('https://cdn.jsdelivr.net/gh/T4ctica1YT/TACTICS-V2@main/assets/Proxy/adblock.js'); }

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

/* ---------- Ad blocker ----------
   Every proxied request (any engine) passes through here, so it is checked against uBlock Origin's
   default filter lists, the same way uBO checks a browser's requests. Blocked requests fail like a
   blocked request in uBO. frame.html tells this worker whether it's on (Settings -> Proxy -> Ad Block). */
const ADBLOCK_CDN = 'https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/';
const ADBLOCK_LISTS = ['filters/filters.min.txt', 'filters/badware.min.txt', 'filters/privacy.min.txt',
                       'filters/quick-fixes.min.txt', 'filters/unbreak.min.txt',
                       'thirdparties/easylist.txt', 'thirdparties/easyprivacy.txt'];
const ADBLOCK_CACHE = 'tactics-adblock-v1';
const ADBLOCK_SELFIE = BASE + '__adblock/engine';
const ADBLOCK_STATE = BASE + '__adblock/on';
// Filter lists are downloaded again after this long (uBO updates its lists every few days too).
const ADBLOCK_MAX_AGE = 4 * 24 * 60 * 60 * 1000;
// How long a request waits for the engine when the worker has just started.
const ADBLOCK_WAIT_MS = 2000;
let adblockOn = true;
let adblockEngine = null;    // Promise, set while/once the engine is loaded

async function compileAdblock(cache){
  const lists = await Promise.all(ADBLOCK_LISTS.map(name => nativeFetch(ADBLOCK_CDN + name)
    .then(r => r.ok ? r.text() : '').catch(()=> '').then(raw => ({ name, raw }))));
  if(!lists.some(l => l.raw)) throw new Error('could not download the filter lists');
  TacticsAdblock.compile(lists);
  await cache.put(ADBLOCK_SELFIE, new Response(TacticsAdblock.serialize(), { headers: { 'x-saved': String(Date.now()) } }));
}
function loadAdblock(){
  if(adblockEngine) return adblockEngine;
  adblockEngine = (async ()=>{
    const cache = await caches.open(ADBLOCK_CACHE);
    const saved = await cache.match(ADBLOCK_SELFIE);
    if(saved){
      try{
        TacticsAdblock.deserialize(await saved.text());
        if(Date.now() - Number(saved.headers.get('x-saved') || 0) > ADBLOCK_MAX_AGE) compileAdblock(cache).catch(()=>{});
        return true;
      }catch(e){}
    }
    await compileAdblock(cache);
    return true;
  })().catch((e)=>{ adblockEngine = null; console.warn('TACTICS ad block:', e); return false; });
  return adblockEngine;
}
const adblockStateLoaded = caches.open(ADBLOCK_CACHE).then(c => c.match(ADBLOCK_STATE)).then(r => r ? r.text() : '1')
  .then(v => { adblockOn = v !== '0'; if(adblockOn) loadAdblock(); }).catch(()=>{});

self.addEventListener('message', (e)=>{
  if(!e.data || typeof e.data.tacticsAdblock !== 'boolean') return;
  adblockOn = e.data.tacticsAdblock;
  if(adblockOn) loadAdblock();
  e.waitUntil(caches.open(ADBLOCK_CACHE).then(c => c.put(ADBLOCK_STATE, new Response(adblockOn ? '1' : '0'))).catch(()=>{}));
});

const SJ2_PREFIX = BASE + '~/sj/';
// A proxied URL on this host -> the real URL it stands for ('' if it isn't one).
function realUrl(href){
  try{
    const u = new URL(href);
    if(u.origin !== self.location.origin) return '';
    const rest = u.href.slice(u.origin.length);
    if(u.pathname.startsWith(uvCfg.prefix)) return Ultraviolet.codec.xor.decode(rest.slice(uvCfg.prefix.length));
    if(u.pathname.startsWith(isCfg.prefix)) return Ultraviolet.codec.xor.decode(rest.slice(isCfg.prefix.length));
    if(u.pathname.startsWith(SJ2_PREFIX)){
      // ~/sj/<controller id>/<frame id>/<encoded url>
      return decodeURIComponent(rest.slice(SJ2_PREFIX.length).split('/').slice(2).join('/').split('?')[0]);
    }
    if(u.pathname.startsWith(BASE + 'scramjet/')) return decodeURIComponent(rest.slice((BASE + 'scramjet/').length).split('?')[0]);
  }catch(e){}
  return '';
}
// request.destination -> uBO's request types.
const ADBLOCK_TYPES = { '': 'xmlhttprequest', script: 'script', worker: 'script', sharedworker: 'script', style: 'stylesheet',
                        image: 'image', font: 'font', audio: 'media', video: 'media', track: 'media', iframe: 'sub_frame',
                        frame: 'sub_frame', object: 'object', embed: 'object', manifest: 'other', report: 'other' };

async function adblocked(event, target){
  if(!target || !/^https?:/i.test(target)) return false;
  await adblockStateLoaded;
  if(!adblockOn) return false;
  const type = ADBLOCK_TYPES[event.request.destination];
  if(!type) return false;
  // The page shown in a tab is the frame inside frame.html: its referrer isn't a proxied URL.
  // Only things a proxied page loads are filtered, never the page the user opened.
  let origin = realUrl(event.request.referrer);
  if(!origin && event.clientId){
    try{ const c = await self.clients.get(event.clientId); if(c) origin = realUrl(c.url); }catch(e){}
  }
  if(!origin) return false;
  const ready = await Promise.race([loadAdblock(), new Promise(r => setTimeout(()=> r(false), ADBLOCK_WAIT_MS))]);
  if(!ready) return false;
  try{ return TacticsAdblock.match({ originURL: origin, url: target, type }) === 1; }catch(e){ return false; }
}

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', (e)=> e.waitUntil(self.clients.claim()));

async function handleRequest(event){
  const url = new URL(event.request.url);
  if(url.origin === self.location.origin && await adblocked(event, realUrl(url.href))) return Response.error();
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

/* TACTICS - V2: cross-origin isolation for games that need it.
 * Some games (threaded Godot 4 / Unity / Emscripten builds using SharedArrayBuffer) only run when
 * the page is served with Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.
 * The site's hosts can't send those, so this worker adds them - but only to the separate game tab
 * the site opens for those games (its URL has ?coi). Everything else passes straight through.
 * It has to sit next to the site's HTML (same folder), which is why it isn't on jsDelivr.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function withIsolationHeaders(res, coep){
  if(!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', coep);
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// 'credentialless' lets the game load images/scripts from other sites without them opting in;
// browsers without it (Safari) get 'require-corp'. The game tab picks via ?coep=.
function coepFor(url){
  return url.searchParams.get('coep') === 'require-corp' ? 'require-corp' : 'credentialless';
}

async function isolatedClientUrl(clientId){
  if(!clientId) return null;
  try{
    const client = await self.clients.get(clientId);
    if(client){ const u = new URL(client.url); if(u.searchParams.has('coi')) return u; }
  }catch(e){}
  return null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // The game tab itself.
  if(req.mode === 'navigate'){
    if(!url.searchParams.has('coi')) return;
    event.respondWith(fetch(req).then((res) => withIsolationHeaders(res, coepFor(url))));
    return;
  }

  // Worker scripts started by the game tab need the same headers to run inside it.
  if(req.destination === 'worker' || req.destination === 'sharedworker'){
    event.respondWith((async () => {
      const page = await isolatedClientUrl(event.clientId);
      const res = await fetch(req);
      return page ? withIsolationHeaders(res, coepFor(page)) : res;
    })());
  }
});

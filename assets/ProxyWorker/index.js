/* TACTICS - V2 proxy host worker (deployed as the "prox" Cloudflare Worker).
 *
 * - Serves the proxy files in ../Proxy (frame.html, sw.js, baremux-worker.js) exactly as before.
 * - Relays Wisp WebSockets at /wisp/ to a public Wisp server. Some devices/networks block public
 *   Wisp servers directly ("Wisp WebSocket failed to connect"); going through this host avoids that,
 *   since the device only ever talks to this host. Returning fetch()'s 101 response hands the
 *   WebSocket to Cloudflare's runtime, which pipes it without running this code per message.
 *
 * Deploy: see README.md in this folder.
 */
const DEFAULT_UPSTREAM = 'wss://wisp.mercurywork.shop/';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/wisp' || url.pathname === '/wisp/') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('TACTICS Wisp relay: connect with a WebSocket.', { status: 426 });
      }
      // fetch() takes http(s) URLs; the Upgrade header in `request` makes it a WebSocket.
      const upstream = String(env.WISP_UPSTREAM || DEFAULT_UPSTREAM).replace(/^ws(s?):/i, 'http$1:');
      return fetch(upstream, request);
    }
    return env.ASSETS.fetch(request);
  }
};

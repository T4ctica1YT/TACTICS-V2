/* TACTICS - V2 proxy host worker (deployed as the "prox" Cloudflare Worker).
 *
 * - Serves the proxy files in ../Proxy (frame.html, sw.js, baremux-worker.js) exactly as before.
 * - /wisp/ is a Wisp server (wisp.js), so sites see Cloudflare's IP rather than a public Wisp
 *   server's (YouTube won't play videos for those). frame.html uses it first.
 *   Each connection runs in its own Durable Object: a normal Worker request only gets ~10 ms of CPU
 *   on the free plan and the whole WebSocket counts as one request, so Cloudflare killed it after a
 *   few seconds of browsing ("Wisp: MuxTaskEnded"). A Durable Object's CPU allowance resets with
 *   every message the browser sends.
 * - /wisp-relay/ just relays the WebSocket to the public Wisp server (WISP_UPSTREAM). Returning
 *   fetch()'s 101 response hands the WebSocket to Cloudflare's runtime, which pipes it without
 *   running this code per message.
 *
 * Deploy: see README.md in this folder.
 */
import { DurableObject } from 'cloudflare:workers';
import { handleWisp } from './wisp.js';

const DEFAULT_UPSTREAM = 'wss://wisp.mercurywork.shop/';
const upstreamOf = (env)=> String(env.WISP_UPSTREAM || DEFAULT_UPSTREAM);

export class WispServer extends DurableObject {
  async fetch(request) {
    return handleWisp(upstreamOf(this.env));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    if (path === '/wisp' || path === '/wisp-relay') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('TACTICS Wisp server: connect with a WebSocket.', { status: 426 });
      }
      if (path === '/wisp') return env.WISP.get(env.WISP.newUniqueId()).fetch(request);
      // fetch() takes http(s) URLs; the Upgrade header in `request` makes it a WebSocket.
      return fetch(upstreamOf(env).replace(/^ws(s?):/i, 'http$1:'), request);
    }
    return env.ASSETS.fetch(request);
  }
};

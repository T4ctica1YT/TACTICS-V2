# TACTICS - V2 proxy host worker

The `prox` worker (prox.t4ctica1yt.workers.dev):

- serves `../Proxy` (frame.html, sw.js, baremux-worker.js; `T4ctic$/` is left out by `../Proxy/.assetsignore`),
- runs a **Wisp server** at `wss://prox.t4ctica1yt.workers.dev/wisp/` (`wisp.js`), and
- keeps the old plain relay to the public Wisp server at `/wisp-relay/`.

## Why the Worker has its own Wisp server

YouTube refuses to play videos ("Video unavailable") when requests come from the public Wisp
server's IP. The Wisp server in `wisp.js` opens each connection from Cloudflare instead
(`connect()` from `cloudflare:sockets`), and YouTube plays normally.

Cloudflare doesn't let Workers open sockets to Cloudflare's own IP ranges, so connections to sites
hosted behind Cloudflare (Discord, etc.), and UDP, are passed to `WISP_UPSTREAM` instead.
That happens automatically for each connection.

Each Wisp connection runs in its own Durable Object (`WispServer` in `index.js`). A plain Worker
request only gets ~10 ms of CPU on the free plan, and a whole WebSocket counts as one request, so
Cloudflare used to kill the connection after a few seconds ("Wisp: MuxTaskEnded"). A Durable
Object's CPU allowance resets with every message the browser sends. Free-plan Durable Objects have
a daily allowance (see Workers & Pages -> prox -> Metrics in the Cloudflare dashboard); if it runs
out, the proxy falls back to the public Wisp server until the next day.

The proxy (frame.html) tries `/wisp/` on this host first, then the public server.

## Deploy (again whenever files here or in ../Proxy change)

Needs Node.js (already installed on the main PC).

```
cd assets/ProxyWorker
npx wrangler login      # first time only, opens a browser to sign in to Cloudflare
npx wrangler deploy
```

To use a different fallback Wisp server, change `WISP_UPSTREAM` in `wrangler.jsonc` and deploy again.

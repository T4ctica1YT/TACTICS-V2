var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// wisp.js
import { connect } from "cloudflare:sockets";
var CONNECT = 1;
var DATA = 2;
var CONTINUE = 3;
var CLOSE = 4;
var INFO = 5;
var TCP = 1;
var REASON_VOLUNTARY = 2;
var REASON_NETWORK = 3;
var BUFFER = 128;
var decoder = new TextDecoder();
function packet(type, id, payload) {
  const body = payload || new Uint8Array(0);
  const out = new Uint8Array(5 + body.byteLength);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, id, true);
  out.set(body, 5);
  return out;
}
__name(packet, "packet");
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
__name(u32, "u32");
function handleWisp(upstreamUrl) {
  const [client, ws] = Object.values(new WebSocketPair());
  ws.accept();
  const streams = /* @__PURE__ */ new Map();
  let upstream = null;
  let closed = false;
  const send = /* @__PURE__ */ __name((type, id, payload) => {
    if (!closed) {
      try {
        ws.send(packet(type, id, payload));
      } catch (e) {
      }
    }
  }, "send");
  function closeStream(id, reason) {
    const s = streams.get(id);
    if (!s) return;
    streams.delete(id);
    if (reason !== void 0) send(CLOSE, id, new Uint8Array([reason]));
    if (s.socket) {
      try {
        s.socket.close();
      } catch (e) {
      }
    }
  }
  __name(closeStream, "closeStream");
  function openUpstream() {
    return (async () => {
      const res = await fetch(upstreamUrl.replace(/^ws(s?):/i, "http$1:"), { headers: { Upgrade: "websocket" } });
      const up = res.webSocket;
      if (!up) throw new Error("upstream Wisp server refused the WebSocket");
      up.accept();
      up.addEventListener("message", (e) => {
        if (typeof e.data === "string") return;
        const d = new Uint8Array(e.data);
        if (d.byteLength < 5) return;
        const id = new DataView(d.buffer, d.byteOffset).getUint32(1, true);
        if (id === 0 || d[0] === INFO) return;
        const s = streams.get(id);
        if (!s || s.mode !== "upstream") return;
        if (d[0] === CLOSE) streams.delete(id);
        if (!closed) {
          try {
            ws.send(d);
          } catch (err) {
          }
        }
      });
      const lost = /* @__PURE__ */ __name(() => {
        upstream = null;
        for (const [id, s] of streams) if (s.mode === "upstream") closeStream(id, REASON_NETWORK);
      }, "lost");
      up.addEventListener("close", lost);
      up.addEventListener("error", lost);
      return up;
    })();
  }
  __name(openUpstream, "openUpstream");
  function toUpstream(bytes) {
    if (!upstream) {
      upstream = openUpstream();
      upstream.catch(() => {
        upstream = null;
      });
    }
    const p = upstream;
    p.then((up) => up.send(bytes)).catch(() => {
      const id = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1, true);
      closeStream(id, REASON_NETWORK);
    });
  }
  __name(toUpstream, "toUpstream");
  function moveToUpstream(id, s, connectPacket) {
    s.mode = "upstream";
    toUpstream(connectPacket);
    for (const data of s.pending) toUpstream(packet(DATA, id, data));
    s.pending = [];
  }
  __name(moveToUpstream, "moveToUpstream");
  function ack(id, s) {
    if (++s.received >= BUFFER / 2) {
      s.received = 0;
      send(CONTINUE, id, u32(BUFFER));
    }
  }
  __name(ack, "ack");
  function write(id, s, data) {
    s.chain = s.chain.then(() => s.writer.write(data)).then(
      () => {
        if (streams.get(id) === s) ack(id, s);
      },
      () => closeStream(id, REASON_NETWORK)
    );
  }
  __name(write, "write");
  async function openTcp(id, host, port, connectPacket) {
    const s = { mode: "opening", pending: [], chain: Promise.resolve(), received: 0 };
    streams.set(id, s);
    let socket;
    try {
      socket = connect({ hostname: host, port });
      await socket.opened;
    } catch (e) {
      try {
        if (socket) socket.close();
      } catch (err) {
      }
      if (streams.get(id) === s) moveToUpstream(id, s, connectPacket);
      return;
    }
    if (streams.get(id) !== s) {
      try {
        socket.close();
      } catch (e) {
      }
      return;
    }
    s.mode = "tcp";
    s.socket = socket;
    s.writer = socket.writable.getWriter();
    for (const data of s.pending) write(id, s, data);
    s.pending = [];
    const reader = socket.readable.getReader();
    try {
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        if (streams.get(id) !== s) return;
        send(DATA, id, value);
      }
      if (streams.get(id) === s) closeStream(id, REASON_VOLUNTARY);
    } catch (e) {
      if (streams.get(id) === s) closeStream(id, REASON_NETWORK);
    }
  }
  __name(openTcp, "openTcp");
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") return;
    const raw = new Uint8Array(e.data);
    if (raw.byteLength < 5) return;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const type = raw[0], id = view.getUint32(1, true);
    const payload = raw.subarray(5);
    if (type === CONNECT) {
      if (raw.byteLength < 8 || streams.has(id)) return;
      const port = view.getUint16(6, true);
      const host = decoder.decode(raw.subarray(8));
      if (raw[5] === TCP) openTcp(id, host, port, raw);
      else {
        const s2 = { pending: [] };
        streams.set(id, s2);
        moveToUpstream(id, s2, raw);
      }
      return;
    }
    const s = streams.get(id);
    if (!s) return;
    if (type === DATA) {
      if (s.mode === "upstream") toUpstream(raw);
      else if (s.mode === "opening") s.pending.push(payload.slice());
      else write(id, s, payload.slice());
    } else if (type === CLOSE) {
      if (s.mode === "upstream") toUpstream(raw);
      closeStream(id);
    }
  });
  const shutdown = /* @__PURE__ */ __name(() => {
    if (closed) return;
    closed = true;
    for (const id of [...streams.keys()]) closeStream(id);
    if (upstream) upstream.then((up) => up.close()).catch(() => {
    });
  }, "shutdown");
  ws.addEventListener("close", shutdown);
  ws.addEventListener("error", shutdown);
  send(CONTINUE, 0, u32(BUFFER));
  return new Response(null, { status: 101, webSocket: client });
}
__name(handleWisp, "handleWisp");

// index.js
var DEFAULT_UPSTREAM = "wss://wisp.mercurywork.shop/";
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    if (path === "/wisp" || path === "/wisp-cf") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("TACTICS Wisp server: connect with a WebSocket.", { status: 426 });
      }
      const upstream = String(env.WISP_UPSTREAM || DEFAULT_UPSTREAM);
      if (path === "/wisp-cf") return handleWisp(upstream);
      return fetch(upstream.replace(/^ws(s?):/i, "http$1:"), request);
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5V87LU/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5V87LU/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map

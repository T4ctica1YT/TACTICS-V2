/* Wisp (v1) server that runs inside the Cloudflare Worker.
 *
 * Each TCP stream is opened from Cloudflare with connect(), so sites see a Cloudflare IP instead of
 * the public Wisp server's (YouTube refuses to play videos for that one). Cloudflare doesn't let
 * Workers open sockets to Cloudflare's own IP ranges, so streams that can't be opened here (and UDP
 * streams, which Workers can't do) are handed to the upstream Wisp server over one shared WebSocket.
 *
 * Wisp packets: type (u8) | stream id (u32 LE) | payload.
 */
import { connect } from 'cloudflare:sockets';

const CONNECT = 0x01, DATA = 0x02, CONTINUE = 0x03, CLOSE = 0x04, INFO = 0x05;
const TCP = 0x01;
const REASON_VOLUNTARY = 0x02, REASON_NETWORK = 0x03;
// How many DATA packets a client may send on a stream before it has to wait for a CONTINUE.
const BUFFER = 128;

const decoder = new TextDecoder();

function packet(type, id, payload){
  const body = payload || new Uint8Array(0);
  const out = new Uint8Array(5 + body.byteLength);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, id, true);
  out.set(body, 5);
  return out;
}
function u32(n){ const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }

export function handleWisp(upstreamUrl){
  const [client, ws] = Object.values(new WebSocketPair());
  ws.accept();

  // id -> { mode: 'opening' | 'tcp' | 'upstream', socket, writer, pending, chain, received }
  const streams = new Map();
  let upstream = null;   // Promise<WebSocket> to the upstream Wisp server, opened on first use
  let closed = false;

  const send = (type, id, payload)=>{ if(!closed){ try{ ws.send(packet(type, id, payload)); }catch(e){} } };

  function closeStream(id, reason){
    const s = streams.get(id);
    if(!s) return;
    streams.delete(id);
    if(reason !== undefined) send(CLOSE, id, new Uint8Array([reason]));
    if(s.socket){ try{ s.socket.close(); }catch(e){} }
  }

  /* ---------- Streams handed to the upstream Wisp server ---------- */
  function openUpstream(){
    return (async ()=>{
      const res = await fetch(upstreamUrl.replace(/^ws(s?):/i, 'http$1:'), { headers: { Upgrade: 'websocket' } });
      const up = res.webSocket;
      if(!up) throw new Error('upstream Wisp server refused the WebSocket');
      up.accept();
      up.addEventListener('message', (e)=>{
        if(typeof e.data === 'string') return;
        const d = new Uint8Array(e.data);
        if(d.byteLength < 5) return;
        const id = new DataView(d.buffer, d.byteOffset).getUint32(1, true);
        // Stream 0 and INFO packets are about the upstream connection itself, not the client's streams.
        if(id === 0 || d[0] === INFO) return;
        const s = streams.get(id);
        if(!s || s.mode !== 'upstream') return;
        if(d[0] === CLOSE) streams.delete(id);
        if(!closed){ try{ ws.send(d); }catch(err){} }
      });
      const lost = ()=>{
        upstream = null;
        for(const [id, s] of streams) if(s.mode === 'upstream') closeStream(id, REASON_NETWORK);
      };
      up.addEventListener('close', lost);
      up.addEventListener('error', lost);
      return up;
    })();
  }
  function toUpstream(bytes){
    if(!upstream){ upstream = openUpstream(); upstream.catch(()=>{ upstream = null; }); }
    const p = upstream;
    p.then(up => up.send(bytes)).catch(()=>{
      // Couldn't reach the upstream server either: fail the stream this packet belongs to.
      const id = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1, true);
      closeStream(id, REASON_NETWORK);
    });
  }
  function moveToUpstream(id, s, connectPacket){
    s.mode = 'upstream';
    toUpstream(connectPacket);
    for(const data of s.pending) toUpstream(packet(DATA, id, data));
    s.pending = [];
  }

  /* ---------- TCP streams opened from this Worker ---------- */
  function ack(id, s){
    if(++s.received >= BUFFER / 2){ s.received = 0; send(CONTINUE, id, u32(BUFFER)); }
  }
  function write(id, s, data){
    s.chain = s.chain.then(()=> s.writer.write(data)).then(()=>{ if(streams.get(id) === s) ack(id, s); },
                                                          ()=> closeStream(id, REASON_NETWORK));
  }
  async function openTcp(id, host, port, connectPacket){
    const s = { mode: 'opening', pending: [], chain: Promise.resolve(), received: 0 };
    streams.set(id, s);
    let socket;
    try{
      socket = connect({ hostname: host, port });
      await socket.opened;
    }catch(e){
      try{ if(socket) socket.close(); }catch(err){}
      if(streams.get(id) === s) moveToUpstream(id, s, connectPacket);
      return;
    }
    if(streams.get(id) !== s){ try{ socket.close(); }catch(e){} return; }
    s.mode = 'tcp';
    s.socket = socket;
    s.writer = socket.writable.getWriter();
    for(const data of s.pending) write(id, s, data);
    s.pending = [];
    const reader = socket.readable.getReader();
    try{
      for(;;){
        const { value, done } = await reader.read();
        if(done) break;
        if(streams.get(id) !== s) return;
        send(DATA, id, value);
      }
      if(streams.get(id) === s) closeStream(id, REASON_VOLUNTARY);
    }catch(e){
      if(streams.get(id) === s) closeStream(id, REASON_NETWORK);
    }
  }

  ws.addEventListener('message', (e)=>{
    if(typeof e.data === 'string') return;
    const raw = new Uint8Array(e.data);
    if(raw.byteLength < 5) return;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const type = raw[0], id = view.getUint32(1, true);
    const payload = raw.subarray(5);
    if(type === CONNECT){
      if(raw.byteLength < 8 || streams.has(id)) return;
      const port = view.getUint16(6, true);
      const host = decoder.decode(raw.subarray(8));
      if(raw[5] === TCP) openTcp(id, host, port, raw);
      else{ const s = { pending: [] }; streams.set(id, s); moveToUpstream(id, s, raw); }
      return;
    }
    const s = streams.get(id);
    if(!s) return;
    if(type === DATA){
      if(s.mode === 'upstream') toUpstream(raw);
      else if(s.mode === 'opening') s.pending.push(payload.slice());
      else write(id, s, payload.slice());
    } else if(type === CLOSE){
      if(s.mode === 'upstream') toUpstream(raw);
      closeStream(id);
    }
  });
  const shutdown = ()=>{
    if(closed) return;
    closed = true;
    for(const id of [...streams.keys()]) closeStream(id);
    if(upstream) upstream.then(up => up.close()).catch(()=>{});
  };
  ws.addEventListener('close', shutdown);
  ws.addEventListener('error', shutdown);

  // Wisp v1 handshake: the server opens with a CONTINUE on stream 0 giving the buffer size.
  send(CONTINUE, 0, u32(BUFFER));
  return new Response(null, { status: 101, webSocket: client });
}

/* TACTICS - V2 Proxy: bare-mux SharedWorker shim.
 * SharedWorkers must be same-origin, so this file lives next to frame.html and pulls the real
 * worker (and the transport) from jsDelivr.
 *
 * It also sets the transport itself as soon as it starts: Epoxy or libcurl (?transport=), using the
 * Wisp server from ?wisp=. The service worker goes idle and restarts often; when it reconnects it can
 * end up talking to a freshly started copy of this worker, and without this every page fails with
 * "there are no bare clients".
 */
const params = new URL(self.location.href).searchParams;
const wisp = params.get('wisp') || 'wss://wisp.mercurywork.shop/';
const useLibcurl = params.get('transport') === 'libcurl';

importScripts('https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@2.1.9/dist/worker.js');
importScripts(useLibcurl
  ? 'https://cdn.jsdelivr.net/npm/@mercuryworkshop/libcurl-transport@1.5.2/dist/index.js'
  : 'https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@2.1.28/dist/index.js');

(function(){
  const conn = new MessageChannel();
  const reply = new MessageChannel();
  reply.port1.onmessage = (e)=>{
    if(e.data && e.data.type === 'error') console.error('TACTICS proxy: could not set the transport', e.data.error);
    reply.port1.close();
    conn.port2.close();
  };
  // Talk to bare-mux the same way a page would: connect, then send a 'set' message.
  self.onconnect({ ports: [conn.port1] });
  conn.port2.postMessage({
    message: {
      type: 'set',
      client: {
        function: useLibcurl
          ? 'const m = self.CurlMod; return [m.default || m, "tactics-libcurl"];'
          : 'const m = self.EpxMod; return [m.default || m, "tactics-epoxy"];',
        args: [{ wisp }]
      }
    },
    port: reply.port2
  }, [reply.port2]);
})();

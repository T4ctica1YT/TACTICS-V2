/* TACTICS - V2 Proxy: bare-mux SharedWorker shim.
 * SharedWorkers must be same-origin, so this file lives next to frame.html and pulls the real
 * worker (and the Epoxy transport) from jsDelivr.
 *
 * It also sets the Wisp transport itself as soon as it starts (Wisp server comes from ?wisp=).
 * The service worker goes idle and restarts often; when it reconnects it can end up talking to
 * a freshly started copy of this worker, and without this every page fails with
 * "there are no bare clients".
 */
importScripts('https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@2.1.9/dist/worker.js');
importScripts('https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@2.1.28/dist/index.js');

(function(){
  const wisp = new URL(self.location.href).searchParams.get('wisp') || 'wss://wisp.mercurywork.shop/';
  const conn = new MessageChannel();
  const reply = new MessageChannel();
  reply.port1.onmessage = (e)=>{
    if(e.data && e.data.type === 'error') console.error('TACTICS proxy: could not set the Wisp transport', e.data.error);
    reply.port1.close();
    conn.port2.close();
  };
  // Talk to bare-mux the same way a page would: connect, then send a 'set' message.
  self.onconnect({ ports: [conn.port1] });
  conn.port2.postMessage({
    message: {
      type: 'set',
      client: {
        function: 'const m = self.EpxMod; return [m.default || m, "tactics-epoxy"];',
        args: [{ wisp }]
      }
    },
    port: reply.port2
  }, [reply.port2]);
})();

/* TACTICS - V2 Proxy: bare-mux SharedWorker shim.
 * SharedWorkers must be same-origin, so this file lives next to frame.html and just
 * pulls the real worker from jsDelivr.
 */
importScripts('https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@2.1.9/dist/worker.js');

# TACTICS - V2 Ad Block

Builds `../Proxy/adblock.js`: uBlock Origin's static network filtering engine
([@gorhill/ubo-core](https://www.npmjs.com/package/@gorhill/ubo-core), from
https://github.com/gorhill/uBlock, GPL-3.0-or-later) as one classic script that the proxy's
service worker (`../Proxy/sw.js`) loads with `importScripts()`.

- `entry.js` is ubo-core's `index.js` without its Node-only parts.
- The service worker downloads uBO's default filter lists (uBlock filters, Badware, Privacy,
  Quick fixes, Unbreak, EasyList, EasyPrivacy) from jsDelivr (`uBlockOrigin/uAssetsCDN`), compiles
  them once, keeps the compiled engine in Cache Storage and refreshes it every 4 days.
- It blocks network requests made by proxied pages, for every proxy engine. uBO's cosmetic filters
  (hiding page elements) and scriptlets are not part of ubo-core, so they aren't applied.
- On/off: Settings -> Proxy -> Ad Block (on by default). The site passes `adblock=0` to frame.html
  when it's off.

## Rebuild (after updating ubo-core)

```
cd assets/AdBlock
npm install
npm run build
cd ../ProxyWorker
npx wrangler deploy
```

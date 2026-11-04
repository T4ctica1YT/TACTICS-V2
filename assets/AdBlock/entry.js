/* TACTICS - V2 ad blocker: uBlock Origin's static network filtering engine for the proxy service worker.
 *
 * This is @gorhill/ubo-core's index.js (https://github.com/gorhill/uBlock, GPL-3.0-or-later) without
 * its Node-only parts (fs, path, util), so it can be bundled into one classic script
 * (../Proxy/adblock.js, built with `npm run build`) and loaded with importScripts().
 *
 * It exposes self.TacticsAdblock:
 *   compile(lists)       lists = [{ name, raw }]; parses filter lists into the engine
 *   serialize()          -> string snapshot of the engine ("selfie"), to skip compiling next time
 *   deserialize(string)  loads a snapshot
 *   match(details)       details = { originURL, url, type }; 1 = block, 2 = allowed by an exception, 0 = no match
 */
import * as s14e from '@gorhill/ubo-core/js/s14e-serializer.js';
import * as sfp from '@gorhill/ubo-core/js/static-filtering-parser.js';
import { CompiledListReader, CompiledListWriter } from '@gorhill/ubo-core/js/static-filtering-io.js';
import { FilteringContext } from '@gorhill/ubo-core/js/filtering-context.js';
import { LineIterator } from '@gorhill/ubo-core/js/text-utils.js';
import publicSuffixList from '@gorhill/ubo-core/lib/publicsuffixlist/publicsuffixlist.js';
import snfe from '@gorhill/ubo-core/js/static-net-filtering.js';
import pslSelfie from '@gorhill/ubo-core/build/publicsuffixlist.json';

// What uBO itself evaluates `!#if` blocks with in a Chromium browser. html_filtering and the other
// capabilities are left out: only network filters are used here.
const ENV = ['ublock', 'chromium'];

publicSuffixList.fromSelfie(pslSelfie);
const fctx = new FilteringContext();

// Same as compileList() in ubo-core's index.js.
function compileList({ name, raw }, compiler, writer){
  const lineIter = new LineIterator(sfp.utils.preparser.prune(raw, ENV));
  if(name) writer.properties.set('name', name);
  const parser = new sfp.AstFilterParser({ maxTokenLength: snfe.MAX_TOKEN_LENGTH });
  while(lineIter.eot() === false){
    let line = lineIter.next();
    while(line.endsWith(' \\')){
      if(lineIter.peek(4) !== '    ') break;
      line = line.slice(0, -2).trim() + lineIter.next().trim();
    }
    parser.parse(line);
    if(parser.isFilter() === false) continue;
    if(parser.isNetworkFilter() === false) continue;
    compiler.compile(parser, writer);
  }
  return writer.toString();
}

self.TacticsAdblock = {
  compile(lists){
    snfe.reset();
    const compiler = snfe.createCompiler();
    for(const list of lists){
      if(typeof list.raw !== 'string' || list.raw === '') continue;
      snfe.fromCompiled(new CompiledListReader(compileList(list, compiler, new CompiledListWriter())));
    }
    snfe.freeze();
    snfe.optimize();
  },
  serialize(){
    return s14e.serialize(snfe.serialize(), { compress: true });
  },
  deserialize(selfie){
    return snfe.unserialize(s14e.deserialize(selfie));
  },
  match(details){
    return snfe.matchRequest(fctx.fromDetails(details));
  }
};

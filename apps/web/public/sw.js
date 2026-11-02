import {SegmentStore} from './cache/storage.mjs';
import {RangeEngine} from './cache/engine.mjs';
// Worker revision 4: disabled/unavailable caching uses native network streaming.
const store=new SegmentStore();
let lastError=null;
const engine=new RangeEngine({store,onError:message=>{lastError=message;}});
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method==='GET' && url.origin===self.location.origin && /^\/api\/videos\/[\w-]+\/stream$/.test(url.pathname) && !url.search)event.respondWith((async()=>{
    try{if(!(await store.settings()).enabled)return fetch(event.request);}catch{return fetch(event.request);}
    return engine.respond(event.request);
  })());
});
self.addEventListener('message',event=>{
  if(!event.ports[0])return;
  event.waitUntil((async()=>{
    try {
      const result=event.data?.type==='CACHE_CONFIG'?await store.configure(event.data.options):await store.settings();
      event.ports[0].postMessage({ok:true,...result,lastError,workerRevision:4});
    }catch{event.ports[0].postMessage({ok:false,message:'Browser storage is unavailable. Streaming can continue.'});}
  })());
});

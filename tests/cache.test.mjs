import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SegmentStore} from '../apps/web/public/cache/storage.mjs';
import {RangeEngine,parseRange,SharedRequests} from '../apps/web/public/cache/engine.mjs';
const url='http://127.0.0.1:5173/api/videos/test/stream';
async function fixture({store,etag='"one"',size=10000,delay=0,wrong=false,headCacheControl='private, max-age=60',partCacheControl='private, max-age=60'}={}){
  const segmentStore=store||new SegmentStore(indexedDB,crypto.randomUUID());if(!store)await segmentStore.configure({enabled:true});
  const bytes=Uint8Array.from({length:size},(_,i)=>i%251),calls=[];
  const fetcher=async(target,options={})=>{
    const method=options.method||target.method||'GET',headers=new Headers(options.headers||(target instanceof Request?target.headers:undefined));
    if(method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),'Content-Type':'video/mp4','ETag':etag,'Cache-Control':headCacheControl}});
    calls.push(headers.get('range'));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const range=parseRange(headers.get('range'),size),data=bytes.slice(range.start,range.end+1);
    return new Response(data,{status:range.partial?206:200,headers:{'Content-Length':String(data.length),...(range.partial?{'Content-Range':`bytes ${range.start}-${wrong?range.end-1:range.end}/${size}`}:{}) ,'ETag':etag,'Cache-Control':partCacheControl}});
  };
  return {engine:new RangeEngine({store:segmentStore,fetcher,segmentSize:1024}),store:segmentStore,calls,bytes};
}
async function read(engine,range){const res=await engine.respond(new Request(url,{headers:range?{Range:range}:{}}));return {res,bytes:new Uint8Array(await res.arrayBuffer())};}
test('inclusive, open, suffix and rejected ranges',()=>{
  assert.deepEqual(parseRange('bytes=100-199',1000),{start:100,end:199,partial:true});
  assert.deepEqual(parseRange('bytes=-100',1000),{start:900,end:999,partial:true});
  assert.equal(parseRange('bytes=900-',1000).end,999);
  assert.equal(parseRange('bytes=900-2000',1000).end,999);
  for(const input of ['bytes=9-8','bytes=-0','bytes=1000-','bytes=0-1,4-5','bytes=foo','bytes=9007199254740992-'])assert.throws(()=>parseRange(input,1000));
});
test('crossing and overlapping ranges reuse exact aligned bytes',async()=>{
  const {engine,calls,bytes}=await fixture();
  let result=await read(engine,'bytes=1000-1100');
  assert.equal(result.res.status,206);assert.equal(result.res.headers.get('content-range'),'bytes 1000-1100/10000');assert.deepEqual(result.bytes,bytes.slice(1000,1101));assert.deepEqual(calls,['bytes=0-1023','bytes=1024-2047']);
  result=await read(engine,'bytes=1010-2200');assert.deepEqual(result.bytes,bytes.slice(1010,2201));assert.deepEqual(calls,['bytes=0-1023','bytes=1024-2047','bytes=2048-3071']);
  result=await read(engine,'bytes=-33');assert.deepEqual(result.bytes,bytes.slice(-33));
});
test('simultaneous requests share one segment',async()=>{
  const {engine,calls}=await fixture({delay:15});await Promise.all([read(engine,'bytes=0-50'),read(engine,'bytes=20-100')]);assert.equal(calls.length,1);
});
test('unavailable storage and quota errors do not break playback',async()=>{
  for(const store of [{settings:async()=>{throw Error('Blocked');}}, {settings:async()=>({enabled:true,generation:0}),get:async()=>null,put:async()=>{throw new DOMException('Full','QuotaExceededError');}}]){
    const {engine,bytes}=await fixture({store});assert.deepEqual((await read(engine,'bytes=50-70')).bytes,bytes.slice(50,71));
  }
});
test('version changes never reuse old segments',async()=>{
  const store=new SegmentStore(indexedDB,crypto.randomUUID());await store.configure({enabled:true});const a=await fixture({store}),b=await fixture({store,etag:'"two"'});
  await read(a.engine,'bytes=0-15');await read(b.engine,'bytes=0-15');assert.equal(b.calls.length,1);
});
test('storage limit evicts, clear fences pending writes, disabling clears',async()=>{
  const store=new SegmentStore(indexedDB,crypto.randomUUID());await store.configure({limit:1024*1024,enabled:true});
  const put=(key,generation=0)=>store.put({key,data:new ArrayBuffer(600000),end:599999},generation);
  await put('one');await put('two');assert.equal(await store.get('one'),undefined);assert.equal((await store.settings()).total,600000);
  await store.configure({clear:true});assert.equal(await put('stale',0),false);assert.equal((await store.settings()).total,0);
  await put('three',1);await store.configure({enabled:false});assert.equal((await store.settings()).total,0);assert.equal(await put('four',2),false);
});
test('no eager full download; cancellation stops additional parts',async()=>{
  const {engine,calls}=await fixture();const response=await engine.respond(new Request(url));const reader=response.body.getReader();await reader.read();await reader.cancel();assert.equal(calls.length,1);
});
test('mismatched upstream range fails instead of returning corrupt bytes',async()=>{
  const {engine}=await fixture({wrong:true});await assert.rejects(()=>read(engine,'bytes=10-20'),/incomplete range/);
});
test('upstream full-file response is canceled without buffering it',async()=>{
  let canceled=false;const engine=new RangeEngine({store:{settings:async()=>{throw Error('No DB');}},fetcher:async(u,o)=>o.method==='HEAD'?new Response(null,{headers:{'Content-Length':'10000000',ETag:'"a"'}}):new Response(new ReadableStream({cancel(){canceled=true;}}),{status:200,headers:{'Content-Length':'10000000'}})});
  await assert.rejects(()=>read(engine,'bytes=0-1023'));assert.equal(canceled,true);
});
test('canceling one shared consumer does not abort another',async()=>{
  const shared=new SharedRequests(),cancel=new AbortController();let release;const work=signal=>new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('Aborted')));});
  const first=shared.get('same',work,cancel.signal),second=shared.get('same',work);await Promise.resolve();cancel.abort();await assert.rejects(first);release('ok');assert.equal(await second,'ok');
});
test('invalid ranges produce 416 without any segment request',async()=>{
  const {engine,calls}=await fixture();const {res}=await read(engine,'bytes=10000-');assert.equal(res.status,416);assert.equal(res.headers.get('content-range'),'bytes */10000');assert.equal(calls.length,0);
});

test('failed HEAD probes preserve the original GET and its JSON error body',async()=>{
  for(const status of [403,404,503]){
    const request=new Request(url,{headers:{Range:'bytes=20-100','If-Range':'"one"'},credentials:'include',signal:new AbortController().signal});
    const error={error:`Stream unavailable (${status})`},calls=[];
    const engine=new RangeEngine({store:{settings:async()=>assert.fail('Failed probes must bypass segment storage')},fetcher:async(target,options)=>{
      calls.push(target);
      if(options?.method==='HEAD'){assert.equal(target,url);return new Response(null,{status});}
      assert.equal(target,request);return Response.json(error,{status,headers:{'Cache-Control':'no-store'}});
    }});
    const response=await engine.respond(request);
    assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),error);assert.deepEqual(calls,[url,request]);
  }
});

test('HEAD rejection falls back to a successful native GET range',async()=>{
  const request=new Request(url,{headers:{Range:'bytes=20-100'}}),bytes=Uint8Array.from({length:81},(_,i)=>i+20);let calls=0;
  const engine=new RangeEngine({store:{settings:async()=>assert.fail('Failed probes must bypass segment storage')},fetcher:async(target,options)=>{
    calls++;
    if(options?.method==='HEAD')return new Response(null,{status:405});
    assert.equal(target,request);return new Response(bytes,{status:206,headers:{'Content-Range':'bytes 20-100/10000','Content-Length':'81','Cache-Control':'no-store'}});
  }});
  const response=await engine.respond(request);
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 20-100/10000');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(calls,2);
});

test('segment storage starts disabled until explicitly enabled',async()=>{
  const store=new SegmentStore(indexedDB,crypto.randomUUID());assert.equal((await store.settings()).enabled,false);
  assert.equal(await store.put({key:'unconsented',data:new ArrayBuffer(4)},0),false);assert.equal((await store.settings()).total,0);
});

test('no-store partial responses stream exact bytes without persisting even when opted in',async()=>{
  for(const directive of ['no-store','private, No-StOrE, max-age=0']){
    const {engine,store,calls,bytes}=await fixture({partCacheControl:directive});
    assert.deepEqual((await read(engine,'bytes=20-100')).bytes,bytes.slice(20,101));
    assert.deepEqual((await read(engine,'bytes=30-70')).bytes,bytes.slice(30,71));
    assert.deepEqual(calls,['bytes=0-1023','bytes=0-1023']);assert.equal((await store.settings()).total,0);
  }
});

test('no-store HEAD bypasses previously cached segments and preserves native Range delivery',async()=>{
  const {engine,store,calls,bytes}=await fixture({headCacheControl:'private, NO-STORE',partCacheControl:'no-store'});
  await store.put({key:`${url}|"one"|0`,videoId:'test',etag:'"one"',start:0,end:1023,data:new Uint8Array(1024).fill(255).buffer},0);
  let reads=0,writes=0;const get=store.get.bind(store),put=store.put.bind(store);store.get=(...a)=>{reads++;return get(...a);};store.put=(...a)=>{writes++;return put(...a);};
  const result=await read(engine,'bytes=20-100');assert.equal(result.res.status,206);assert.equal(result.res.headers.get('content-range'),'bytes 20-100/10000');assert.deepEqual(result.bytes,bytes.slice(20,101));
  assert.deepEqual(calls,['bytes=20-100']);assert.equal(reads,0);assert.equal(writes,0);
  const full=await read(engine);assert.equal(full.res.status,200);assert.deepEqual(full.bytes,bytes);
});

async function workerHarness(store){
  const handlers=new Map();let claimed=false,nativeCalls=0;
  const self={location:new URL(url),clients:{claim:async()=>{claimed=true;}},skipWaiting:()=>{},addEventListener:(type,handler)=>handlers.set(type,handler)};
  const source=(await readFile(new URL('../apps/web/public/sw.js',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'');
  vm.runInNewContext(source,{self,URL,SegmentStore:function(){return store;},RangeEngine:class{respond(){assert.fail('Disabled/unavailable storage must use native streaming');}},fetch:async request=>{nativeCalls++;assert.equal(request.url,url);return new Response('network playback');}});
  return{async activate(){let pending;handlers.get('activate')({waitUntil:work=>{pending=work;}});await pending;assert.equal(claimed,true);},async stream(){let pending;handlers.get('fetch')({request:new Request(url,{headers:{Range:'bytes=20-100'}}),respondWith:work=>{pending=work;}});assert.equal(await(await pending).text(),'network playback');assert.equal(nativeCalls,1);}};
}

test('worker upgrade clears legacy bytes, disables caching and fences old pending writes',async()=>{
  const store=new SegmentStore(indexedDB,crypto.randomUUID());await store.configure({enabled:true});const generation=(await store.settings()).generation;
  await store.put({key:'legacy-private-segment',data:new ArrayBuffer(1024)},generation);
  const worker=await workerHarness(store);await worker.activate();const settings=await store.settings();
  assert.equal(settings.total,0);assert.equal(settings.enabled,false);assert.equal(settings.generation,generation+1);assert.equal(await store.get('legacy-private-segment'),undefined);
  assert.equal(await store.put({key:'late-old-worker-write',data:new ArrayBuffer(4)},generation),false);
  await worker.stream();
});

test('worker storage cleanup failure still claims clients and keeps native playback available',async()=>{
  const store={configure:async()=>{throw Error('Storage unavailable');},settings:async()=>{throw Error('Storage unavailable');}};
  const worker=await workerHarness(store);await worker.activate();await worker.stream();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {SegmentStore} from '../apps/web/public/cache/storage.mjs';
import {RangeEngine,parseRange,SharedRequests} from '../apps/web/public/cache/engine.mjs';
const url='http://127.0.0.1:5173/api/videos/test/stream';
function fixture({store,etag='"one"',size=10000,delay=0,wrong=false}={}){
  const bytes=Uint8Array.from({length:size},(_,i)=>i%251),calls=[];
  const fetcher=async(target,options)=>{
    if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),'Content-Type':'video/mp4','ETag':etag}});
    calls.push(options.headers.Range);
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const range=parseRange(options.headers.Range,size),data=bytes.slice(range.start,range.end+1);
    return new Response(data,{status:206,headers:{'Content-Length':String(data.length),'Content-Range':`bytes ${range.start}-${wrong?range.end-1:range.end}/${size}`,'ETag':etag}});
  };
  return {engine:new RangeEngine({store:store||new SegmentStore(indexedDB,crypto.randomUUID()),fetcher,segmentSize:1024}),calls,bytes};
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
  const {engine,calls,bytes}=fixture();
  let result=await read(engine,'bytes=1000-1100');
  assert.equal(result.res.status,206);assert.equal(result.res.headers.get('content-range'),'bytes 1000-1100/10000');assert.deepEqual(result.bytes,bytes.slice(1000,1101));assert.deepEqual(calls,['bytes=0-1023','bytes=1024-2047']);
  result=await read(engine,'bytes=1010-2200');assert.deepEqual(result.bytes,bytes.slice(1010,2201));assert.deepEqual(calls,['bytes=0-1023','bytes=1024-2047','bytes=2048-3071']);
  result=await read(engine,'bytes=-33');assert.deepEqual(result.bytes,bytes.slice(-33));
});
test('simultaneous requests share one segment',async()=>{
  const {engine,calls}=fixture({delay:15});await Promise.all([read(engine,'bytes=0-50'),read(engine,'bytes=20-100')]);assert.equal(calls.length,1);
});
test('unavailable storage and quota errors do not break playback',async()=>{
  for(const store of [{settings:async()=>{throw Error('Blocked');}}, {settings:async()=>({enabled:true,generation:0}),get:async()=>null,put:async()=>{throw new DOMException('Full','QuotaExceededError');}}]){
    const {engine,bytes}=fixture({store});assert.deepEqual((await read(engine,'bytes=50-70')).bytes,bytes.slice(50,71));
  }
});
test('version changes never reuse old segments',async()=>{
  const store=new SegmentStore(indexedDB,crypto.randomUUID());const a=fixture({store}),b=fixture({store,etag:'"two"'});
  await read(a.engine,'bytes=0-15');await read(b.engine,'bytes=0-15');assert.equal(b.calls.length,1);
});
test('storage limit evicts, clear fences pending writes, disabling clears',async()=>{
  const store=new SegmentStore(indexedDB,crypto.randomUUID());await store.configure({limit:1024*1024});
  const put=(key,generation=0)=>store.put({key,data:new ArrayBuffer(600000),end:599999},generation);
  await put('one');await put('two');assert.equal(await store.get('one'),undefined);assert.equal((await store.settings()).total,600000);
  await store.configure({clear:true});assert.equal(await put('stale',0),false);assert.equal((await store.settings()).total,0);
  await put('three',1);await store.configure({enabled:false});assert.equal((await store.settings()).total,0);assert.equal(await put('four',2),false);
});
test('no eager full download; cancellation stops additional parts',async()=>{
  const {engine,calls}=fixture();const response=await engine.respond(new Request(url));const reader=response.body.getReader();await reader.read();await reader.cancel();assert.equal(calls.length,1);
});
test('mismatched upstream range fails instead of returning corrupt bytes',async()=>{
  const {engine}=fixture({wrong:true});await assert.rejects(()=>read(engine,'bytes=10-20'),/incomplete range/);
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
  const {engine,calls}=fixture();const {res}=await read(engine,'bytes=10000-');assert.equal(res.status,416);assert.equal(res.headers.get('content-range'),'bytes */10000');assert.equal(calls.length,0);
});

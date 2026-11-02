import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {openRangeSource,readVideoRange,createThumbnailService,thumbnailKey,sampleTimes,frameArguments} from '../services/api/src/thumbnails.mjs';
import {createAPI} from '../services/api/src/server.mjs';

const video={id:'channel-42-3',filename:'actual.mkv',sizeBytes:100,uploadedAt:'2026-11-02',mimeType:'video/x-matroska'};
const jpeg=Buffer.from([255,216,1,2,255,217]);
const ready=async(check)=>{for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Thumbnail job did not finish');};

test('range source permits only its private job URL and caps bytes and requests',async t=>{
  const abort=new AbortController(),reads=[];
  const source=await openRangeSource(video,{signal:abort.signal,maxBytes:8,maxRequests:2,chunkSize:4,readRange:async(start,end)=>{reads.push([start,end]);return Buffer.alloc(end-start+1,7);}});t.after(()=>{abort.abort();source.close();});
  assert.equal((await fetch(new URL('/unknown',source.url))).status,404);
  assert.equal((await fetch(source.url,{method:'HEAD'})).headers.get('content-length'),'100');
  assert.equal(reads.length,0);
  const first=await fetch(source.url,{headers:{Range:'bytes=0-3'}});assert.equal(first.status,206);assert.equal(first.headers.get('content-range'),'bytes 0-3/100');assert.equal((await first.arrayBuffer()).byteLength,4);
  assert.equal((await fetch(source.url,{headers:{Range:'bytes=100-'}})).status,416);
  const second=await fetch(source.url,{headers:{Range:'bytes=90-93'}});assert.equal(second.headers.get('content-range'),'bytes 90-93/100');await second.arrayBuffer();
  assert.equal((await fetch(source.url,{headers:{Range:'bytes=4-7'}})).status,503);
  assert.deepEqual(reads,[[0,3],[90,93]]);assert.equal(source.stats.bytes,8);assert.equal(source.stats.requests,2);assert.equal(source.stats.exhausted,true);
});

test('open-ended FFmpeg reads stop at the budget instead of fetching an entire video',async t=>{
  const abort=new AbortController(),reads=[];
  const source=await openRangeSource(video,{signal:abort.signal,maxBytes:8,chunkSize:4,readRange:async(start,end)=>{reads.push([start,end]);await new Promise(r=>setTimeout(r,5));return Buffer.alloc(end-start+1);}});t.after(()=>{abort.abort();source.close();});
  const response=await fetch(source.url,{headers:{Range:'bytes=0-'}});
  assert.equal(response.headers.get('content-range'),'bytes 0-99/100');
  await assert.rejects(response.arrayBuffer());assert.deepEqual(reads,[[0,3],[4,7]]);assert.equal(source.stats.exhausted,true);
});

test('upstream reads require exact authenticated partial responses and reject full downloads',async()=>{
  const options={video,start:4,end:7,streamOrigin:'http://stream-go:8080',streamToken:'private-token',signal:new AbortController().signal};
  const bytes=await readVideoRange({...options,fetcher:async(url,opts)=>{
    assert.equal(url.href,'http://stream-go:8080/internal/videos/channel-42-3/stream');assert.equal(opts.headers.Authorization,'Bearer private-token');assert.equal(opts.headers.Range,'bytes=4-7');assert.equal(opts.redirect,'error');
    return new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{'Content-Range':'bytes 4-7/100','Content-Length':'4'}});
  }});assert.deepEqual([...bytes],[1,2,3,4]);
  let cancelled=false;
  await assert.rejects(readVideoRange({...options,fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:200})}));assert.equal(cancelled,true);
  await assert.rejects(readVideoRange({...options,fetcher:async()=>new Response(Buffer.alloc(5),{status:206,headers:{'Content-Range':'bytes 4-7/100','Content-Length':'4'}})}));
  const identity={};let etag='"original"';
  const fetcher=async(url,opts)=>{if(identity.etag)assert.equal(opts.headers['If-Range'],'"original"');return new Response(Buffer.alloc(4),{status:206,headers:{'Content-Range':'bytes 4-7/100','Content-Length':'4',ETag:etag}});};
  await readVideoRange({...options,fetcher,identity});etag='"replacement"';await assert.rejects(readVideoRange({...options,fetcher,identity}));
});

test('thumbnail jobs deduplicate, serialize, cache failures and invalidate changed files',async t=>{
  let calls=0,concurrent=0,peak=0,release;const blocked=new Promise(r=>release=r);
  const service=createThumbnailService({streamOrigin:'http://unused',streamToken:'x',logger:()=>{},extract:async()=>{calls++;concurrent++;peak=Math.max(peak,concurrent);await blocked;concurrent--;return jpeg;}});t.after(()=>service.close());
  const first=service.get(video);assert.equal(service.get(video),first);
  const changed={...video,filename:'replacement.mp4'};assert.notEqual(thumbnailKey(video),thumbnailKey(changed));service.get(changed);
  await ready(()=>calls===1);release();await ready(()=>first.status==='ready'&&service.get(changed).status==='ready');
  assert.equal(peak,1);assert.equal(calls,2);assert.equal(service.get(video).bytes,jpeg);assert.equal(calls,2);
  let failures=0;const failed=createThumbnailService({streamOrigin:'http://unused',streamToken:'x',logger:()=>{},extract:async()=>{failures++;throw Error('Unsupported video');}});t.after(()=>failed.close());
  const entry=failed.get(video);await ready(()=>entry.status==='unavailable');failed.get(video);assert.equal(failures,3);
  assert.deepEqual(sampleTimes(2),[.3,.8,1.3]);assert.deepEqual(sampleTimes(null),[90,30,5]);
  const args=frameArguments('http://127.0.0.1:123/job',30);assert.ok(args.includes('http,tcp'));assert.ok(args.includes('8'));assert.ok(args.some(v=>v.includes('blackframe')));
});

test('transient stream errors retry while cancellation stops further requests',async()=>{
  let calls=0;
  const options={video,start:0,end:3,streamOrigin:'http://stream-go:8080',streamToken:'private',signal:new AbortController().signal};
  const bytes=await readVideoRange({...options,fetcher:async()=>++calls===1?new Response('Temporary failure',{status:502}):new Response(Buffer.alloc(4),{status:206,headers:{'Content-Range':'bytes 0-3/100','Content-Length':'4'}})});
  assert.equal(calls,2);assert.equal(bytes.length,4);
  calls=0;await assert.rejects(readVideoRange({...options,signal:AbortSignal.timeout(20),fetcher:async()=>{calls++;return new Response('Busy',{status:503});}}));assert.equal(calls,1);
});

test('thumbnail API authenticates and validates catalogue identity before any extraction',async t=>{
  const calls=[];let state='pending',closed=false;
  const thumbnails={get(v,options){calls.push({v,options});return {status:state,bytes:jpeg};},close(){closed=true;}};
  const handler=createAPI({streamOrigin:'http://private',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),thumbnails,fetcher:async()=>new Response(JSON.stringify({items:[video]}))});
  const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{handler.close();server.closeAllConnections();server.close();assert.equal(closed,true);});
  const root=`http://127.0.0.1:${server.address().port}`,get=(path,options={})=>fetch(root+path,{...options,headers:{'x-gateway-token':'g'.repeat(40)}});
  assert.equal((await fetch(root+'/api/videos/channel-42-3/thumbnail')).status,401);
  assert.equal((await get('/api/videos/unknown/thumbnail')).status,404);
  assert.equal((await get('/api/videos/channel-42-3/thumbnail?url=https://elsewhere')).status,400);assert.equal(calls.length,0);
  const pending=await get('/api/videos/channel-42-3/thumbnail');assert.equal(pending.status,202);assert.equal(pending.headers.get('retry-after'),'3');
  state='ready';const image=await get('/api/videos/channel-42-3/thumbnail');assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await image.arrayBuffer()),jpeg);
  const head=await get('/api/videos/channel-42-3/thumbnail',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(calls.at(-1).options.generate,false);
  state='unavailable';assert.equal((await get('/api/videos/channel-42-3/thumbnail')).status,404);
});

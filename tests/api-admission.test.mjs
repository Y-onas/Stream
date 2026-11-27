import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAPI} from '../services/api/src/server.mjs';

const streamToken='s'.repeat(40),gatewayToken='g'.repeat(40),sessionId='01234567-1234-4234-8234-012345678901';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function serve(t,application,fetcher){
 const handler=createAPI({streamOrigin:'http://synthetic.test',streamToken,gatewayToken,application,fetcher,thumbnails:{close(){}}}),server=http.createServer(handler);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();server.close();await handler.close();});
 const get=(path,signal)=>fetch(`http://127.0.0.1:${server.address().port}`+path,{headers:{'X-Gateway-Token':gatewayToken},signal});
 return {server,get};
}

test('media authorization and initial upstream work are bounded; open bodies release their permits',{timeout:15000},async t=>{
 // Deterministic admission regression using tiny synthetic bodies and held
 // promises. This is not a source/load/throughput test.
 const authorized=deferred(),authorizationStarted=deferred(),upstreamReady=deferred(),upstreamStarted=deferred();
 let authorizations=0,upstreams=0;
 const application={config:{},close(){},handle:async(req,res)=>{res.end('{}');return true;},playback:{introspect:async()=>({key:'fixture',videoId:sessionId,leaseUntil:Date.now()+60000}),async stream(){if(++authorizations===32)authorizationStarted.resolve();await authorized.promise;return {grant:'fixture',videoId:sessionId};}}};
 const fetcher=async(url,{signal})=>{
  if(++upstreams===32)upstreamStarted.resolve();await upstreamReady.promise;
  return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}),{headers:{'Content-Length':'2','Content-Type':'video/mp4'}});
 };
 const {get,server}=await serve(t,application,fetcher),bodies=[];
 t.after(async()=>{authorized.resolve();upstreamReady.resolve();await Promise.allSettled(bodies.map(body=>body.cancel()));});
 const opening=Array.from({length:32},()=>get(`/api/playback/${sessionId}/stream`));
 await authorizationStarted.promise;
 let probe=await get('/api/probe');assert.equal(probe.status,503);await probe.text();assert.equal(upstreams,0);
 // Opening Go streams require a callback into Node. Starving that independent
 // control path with public startups would cause every startup in a burst to fail.
 const check=await fetch(`http://127.0.0.1:${server.address().port}/internal/playback/check`,{method:'POST',headers:{Authorization:'Bearer '+streamToken,'Content-Type':'application/json'},body:JSON.stringify({grant:'fixture',reservationId:sessionId})});
 assert.equal(check.status,200);await check.json();
 authorized.resolve();await upstreamStarted.promise;
 probe=await get('/api/probe');assert.equal(probe.status,503);await probe.text();
 upstreamReady.resolve();
 for(const response of await Promise.all(opening)){assert.equal(response.status,200);const reader=response.body.getReader();bodies.push(reader);assert.equal((await reader.read()).value[0],1);}
 probe=await get('/api/probe');assert.equal(probe.status,200);await probe.text();
 assert.equal(authorizations,32);assert.equal(upstreams,32);
});

test('disconnecting controls cannot free permits while their database work continues',{timeout:15000},async t=>{
 const started=deferred(),settleWork=deferred(),closed=deferred();let count=0,closes=0;
 const application={config:{},close(){},async handle(req,res,url){if(url.pathname==='/api/work'){if(++count===32)started.resolve();await settleWork.promise;}res.end('{}');return true;}};
 const {server,get}=await serve(t,application,()=>{throw Error('Unexpected upstream');});
 server.on('request',(req,res)=>{if(req.url==='/api/work')res.once('close',()=>{if(++closes===32)closed.resolve();});});
 const controllers=Array.from({length:32},()=>new AbortController()),pending=controllers.map(controller=>get('/api/work',controller.signal).catch(()=>null));
 t.after(()=>{settleWork.resolve();for(const controller of controllers)controller.abort();});
 await started.promise;for(const controller of controllers)controller.abort();await closed.promise;await Promise.all(pending);
 let probe=await get('/api/probe');assert.equal(probe.status,503);await probe.text();assert.equal(count,32);
 settleWork.resolve();await new Promise(resolve=>setImmediate(resolve));
 probe=await get('/api/probe');assert.equal(probe.status,200);await probe.text();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAPI} from '../services/api/src/server.mjs';
const streamToken='s'.repeat(40),gatewayToken='g'.repeat(40);
test('real HTTP API follows synchronized records, forwards ranges and reports outages',async t=>{
 let items=[{id:'channel-42-3',title:'Phone recording',filename:'phone.mov',uploadedAt:'2026-10-30',sizeBytes:1000}],ready=true;
 const go=http.createServer((req,res)=>{assert.equal(req.headers.authorization,`Bearer ${streamToken}`);if(req.url==='/readyz'){res.writeHead(ready?200:503);return res.end('{}');}if(req.url==='/internal/catalogue'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items,sync:{initialComplete:true}}));}assert.equal(req.url,'/internal/videos/channel-42-3/stream');assert.equal(req.headers.range,'bytes=100-199');res.writeHead(206,{'Content-Length':'100','Content-Range':'bytes 100-199/1000','Content-Type':'video/quicktime'});res.end(Buffer.alloc(100,7));});go.listen(0,'127.0.0.1');await once(go,'listening');t.after(()=>go.close());
 const api=http.createServer(createAPI({streamOrigin:`http://127.0.0.1:${go.address().port}`,streamToken,gatewayToken}));api.listen(0,'127.0.0.1');await once(api,'listening');t.after(()=>api.close());const root=`http://127.0.0.1:${api.address().port}`;
 const get=(path,headers={})=>fetch(root+path,{headers:{'x-gateway-token':gatewayToken,...headers}});
 assert.equal((await fetch(root+'/api/videos')).status,401);
 let data=await (await get('/api/videos')).json();assert.equal(data.items.length,1);assert.equal(data.source,'telegram-sync');
 items=[...items,{id:'channel-42-4',title:'Android recording',filename:'android.webm',sizeBytes:300}];data=await (await get('/api/videos')).json();assert.equal(data.items.length,2);
 const range=await get('/api/videos/channel-42-3/stream',{Range:'bytes=100-199'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 100-199/1000');assert.deepEqual(new Uint8Array(await range.arrayBuffer()),new Uint8Array(100).fill(7));
 assert.equal((await get('/api/videos/arbitrary/stream')).status,404);assert.equal((await get('/api/trending?period=day')).status,501);
 ready=false;assert.equal((await fetch(root+'/healthz')).status,503);
 await new Promise(resolve=>go.close(resolve));go.closeAllConnections();assert.equal((await get('/api/videos')).status,503);
});

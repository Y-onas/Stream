import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAPI} from '../services/api/src/server.mjs';
const streamToken='s'.repeat(40),gatewayToken='g'.repeat(40),videoId='01234567-1234-4234-8234-012345678901',sessionId='01234567-1234-4234-8234-012345678902';

test('HTTP gateway preserves ranges only after playback authorization and fails closed without application storage',async t=>{
 let items=[{id:videoId,title:'Phone recording',filename:'phone.mov',uploadedAt:'2026-10-30',sizeBytes:1000,accessType:'FREE'}],ready=true;
 const go=http.createServer((req,res)=>{assert.equal(req.headers.authorization,`Bearer ${streamToken}`);if(req.url==='/readyz'){res.writeHead(ready?200:503);return res.end('{}');}assert.equal(req.url,`/internal/videos/${videoId}/stream`);assert.equal(req.headers['x-playback-grant'],'fixture-signed-grant');assert.equal(req.headers.range,'bytes=100-199');res.writeHead(206,{'Content-Length':'100','Content-Range':'bytes 100-199/1000','Content-Type':'video/quicktime'});res.end(Buffer.alloc(100,7));});go.listen(0,'127.0.0.1');await once(go,'listening');t.after(()=>{go.closeAllConnections();go.close();});
 // Grant cryptography and database policy are tested separately against real Go.
 const application={config:{},health:async()=>true,handle:async(req,res,url)=>{if(url.pathname!=='/api/videos')return false;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items,source:'postgresql'}));return true;},playback:{stream:async(req,res,id)=>{if(id!==sessionId||req.headers.cookie!=='hh_playback=fixture-signed-grant')throw Object.assign(Error('Unauthorized'),{status:401});return{grant:'fixture-signed-grant',videoId};}}};
 const api=http.createServer(createAPI({streamOrigin:`http://127.0.0.1:${go.address().port}`,streamToken,gatewayToken,application}));api.listen(0,'127.0.0.1');await once(api,'listening');t.after(()=>{api.closeAllConnections();api.close();});const root=`http://127.0.0.1:${api.address().port}`;
 const get=(route,headers={})=>fetch(root+route,{headers:{'x-gateway-token':gatewayToken,...headers}});
 assert.equal((await fetch(root+'/api/videos')).status,401);
 let data=await(await get('/api/videos')).json();assert.equal(data.items.length,1);assert.equal(data.source,'postgresql');
 items=[...items,{id:sessionId,title:'Android recording',filename:'android.webm',sizeBytes:300}];data=await(await get('/api/videos')).json();assert.equal(data.items.length,2);
 const range=await get(`/api/playback/${sessionId}/stream`,{Cookie:'hh_playback=fixture-signed-grant',Range:'bytes=100-199'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 100-199/1000');assert.deepEqual(new Uint8Array(await range.arrayBuffer()),new Uint8Array(100).fill(7));
 assert.equal((await get(`/api/videos/${videoId}/stream`)).status,401);assert.equal((await get(`/api/playback/${sessionId}/stream`)).status,401);
 ready=false;assert.equal((await fetch(root+'/healthz')).status,503);
 const unavailable=http.createServer(createAPI({streamOrigin:`http://127.0.0.1:${go.address().port}`,streamToken,gatewayToken}));unavailable.listen(0,'127.0.0.1');await once(unavailable,'listening');t.after(()=>{unavailable.closeAllConnections();unavailable.close();});
 assert.equal((await fetch(`http://127.0.0.1:${unavailable.address().port}/api/videos`,{headers:{'x-gateway-token':gatewayToken}})).status,503);
});

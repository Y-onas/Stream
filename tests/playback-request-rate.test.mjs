import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {hash} from '../services/api/src/domain.mjs';

test('invalid traffic cannot exhaust legitimate playback; rotating IPs cannot evade a session limit',async t=>{
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),at=new Date(),expiresAt=new Date(+at+300000);
 const config={timezone:'Africa/Nairobi',supportUsername:'',playbackPrivateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),playbackPublicKey:pair.publicKey.export({type:'spki',format:'pem'})};
 const viewerId=randomUUID(),videoId=randomUUID(),first=randomUUID(),second=randomUUID(),viewerToken='v'.repeat(64);
 let lookups=0,forwarded=0;
 // Exercise actual signed grants, cookie binding, the API limiter and HTTP
 // relay. Trusted DB rows are fixed fixtures; no remote DB/Telegram load.
 const db={appSchema:'public',platformSettings:{findUnique:async()=>({maintenanceMode:false})},async $disconnect(){},async $queryRaw(...args){
  lookups++;const id=args.find(value=>value===first||value===second);return id?[{id,videoId:'private-fixture',viewerId,userId:null,accountSessionId:null,accessType:'FREE',state:'PLAYING',revokedAt:null,expiresAt,reservedUntil:expiresAt,authorizedUntil:expiresAt,video:{id:'private-fixture',publicId:videoId,accessType:'FREE',published:true,available:true,adminUnavailable:false},viewer:{id:viewerId,tokenHash:hash(viewerToken),expiresAt},account:null}]:[];
 }};
 const app=createApplication({db,config}),handler=createAPI({streamOrigin:'http://private-fixture',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',application:app,thumbnails:{get(){},close(){}},fetcher:async()=>{
  forwarded++;return new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{'Content-Type':'video/mp4','Content-Length':'4','Content-Range':'bytes 0-3/1000'}});
 }});
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();server.close();await handler.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const grant=async id=>app.playback.grants.sign({purpose:'playback',vid:videoId,sid:id,ctx:viewerId,mode:'FREE',sub:`anonymous:${viewerId}`},expiresAt);
 const tokens=new Map([[first,await grant(first)],[second,await grant(second)]]);
 async function request(id,{authorized=false,ip='198.51.100.7'}={}){
  const response=await fetch(`${origin}/api/playback/${id}/stream`,{headers:{'X-Gateway-Token':'g'.repeat(40),Origin:'http://viewer.test','X-Client-IP':ip,Range:'bytes=0-3',...(authorized?{Cookie:`hh_playback=${tokens.get(id)}; hh_viewer=${viewerToken}`}:{})}});await response.arrayBuffer();return response.status;
 }
 for(let n=0;n<=180;n++)assert.equal(await request(first),n<180?401:429);
 assert.equal(lookups,0);assert.equal(forwarded,0);
 assert.equal(await request(first,{authorized:true}),206);
 for(let n=1;n<180;n++)assert.equal(await request(first,{authorized:true,ip:n%2?'203.0.113.2':'198.51.100.7'}),206);
 assert.equal(await request(first,{authorized:true,ip:'203.0.113.3'}),429);assert.equal(forwarded,180);
 assert.equal(await request(second,{authorized:true}),206);assert.equal(forwarded,181);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {createPlayback} from '../services/api/src/playback.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {HttpError} from '../services/api/src/domain.mjs';
import {testPlaybackConfig} from './helpers/playback-database.mjs';

function fixture({guest=false}={}){
 const video={id:'private-fixture',publicId:randomUUID(),accessType:'VIP',published:true,available:true,adminUnavailable:false};
 const account={id:randomUUID(),userId:randomUUID(),expiresAt:new Date(Date.now()+3600000),user:{status:'ACTIVE'}};
 const db={appSchema:'public',video:{findUnique:async()=>video},userSession:{findUnique:async()=>account},membership:{findFirst:async()=>null},$transaction:async()=>{throw Error('A denied user must not reserve playback');},$queryRaw:async()=>{throw Error('Invalid grants must not reach playback state');}};
 const playback=createPlayback({db,config:testPlaybackConfig(),production:false,now:()=>new Date(),limit(){},settings:{get:async()=>({maintenanceMode:false})},actor:async()=>{if(guest)throw new HttpError(401,'Sign in first.');return account;},viewer:async()=>{throw Error('A denied user must not receive a playback viewer');}});
 return {video,playback};
}

test('guests and signed-in non-members receive no VIP grant or media URL',async()=>{
 for(const guest of [true,false]){
  const {video,playback}=fixture({guest}),headers=[];
  await assert.rejects(playback.authorize({headers:{}},{getHeader(){},setHeader(...args){headers.push(args);}},video.publicId),error=>[401,403].includes(error.status)&&error.code==='MEMBERSHIP_REQUIRED');
  assert.deepEqual(headers,[],'denial must not set a playback-grant cookie');
 }
});

test('browser GET/HEAD prefetch without a valid grant never reaches Telegram',async t=>{
 const {video,playback}=fixture(),id=randomUUID();let upstreamCalls=0;
 const handler=createAPI({application:{config:{},playback,handle:async()=>false,close(){}},streamOrigin:'http://must-not-fetch.test',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',thumbnails:{close(){}},fetcher:async()=>{upstreamCalls++;throw Error('Unauthorized upstream read');}});
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();server.close();await handler.close();});
 for(const method of ['GET','HEAD'])for(const route of [`/api/playback/${id}/stream`,`/api/videos/${video.publicId}/stream`]){
  const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,headers:{'X-Gateway-Token':'g'.repeat(40),Cookie:'hh_playback=forged-prefetch-token',Range:'bytes=0-1023'}});
  assert.equal(response.status,401);assert.equal(response.headers.get('content-range'),null);assert.ok(!response.headers.get('content-type')?.startsWith('video/'));await response.arrayBuffer();
 }
 assert.equal(upstreamCalls,0);
});

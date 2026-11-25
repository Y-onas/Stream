import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {isolatedDatabase,httpClient,testPlaybackConfig} from './helpers/playback-database.mjs';
import {createPlaybackLifecycle} from '../apps/web/src/services/playback-lifecycle.mjs';

test('video-page close releases VIP slots for every account; two real open sessions remain enforced',{skip:process.env.RUN_DB_TESTS!=='1',timeout:180000},async t=>{
 const db=await isolatedDatabase(t,'hh_close');
 const config={...testPlaybackConfig(),bootstrapEmail:'owner@example.test',currency:'ETB',timezone:'Africa/Nairobi',adminOrigin:'http://admin.test'};
 await seedPlans(db,'ETB');await bootstrapAdministration(db,config);
 const owner=await db.administrator.findUnique({where:{email:config.bootstrapEmail}});
 const videos=[];for(let n=0;n<3;n++)videos.push(await db.video.create({data:{id:`close-fixture-${n}`,title:`Fixture ${n}`,filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1024,uploadedAt:new Date(),accessType:'VIP'}}));
 const app=createApplication({db,config});t.after(()=>app.close());
 const server=http.createServer(createAPI({application:app,streamOrigin:'http://unused.test',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',thumbnails:{close(){}}}));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,accounts=[];
 for(const username of ['CloseViewerOne','CloseViewerTwo']){
  const client=httpClient(origin);assert.equal((await client.call('/api/auth/register',{method:'POST',data:{username,password:'Disposable password 123!'}})).status,201);
  const user=await db.user.findUnique({where:{usernameCanonical:username.toLowerCase()}});
  await db.membership.create({data:{userId:user.id,planId:'monthly',planName:'Fixture membership',durationMonths:1,amountMinor:99000,currency:'ETB',activatedAt:new Date(),expiresAt:new Date(Date.now()+3600000),approvedByAdminId:owner.id,source:'MANUAL'}});
  accounts.push({client,user});
 }
 function page(client,video){return createPlaybackLifecycle({
  authorize:async()=>{const result=await client.call('/api/playback/authorize',{method:'POST',data:{videoId:video.publicId,requestId:randomUUID()}});assert.equal(result.status,201,JSON.stringify(result.body));return result.body;},
  terminate:async session=>{const result=await client.call(`/api/playback/${session.id}/terminate`,{method:'POST',data:{}});assert.equal(result.status,200,JSON.stringify(result.body));}
 });}
 for(const {client,user}of accounts){
  for(const video of [...videos,...videos]){
   const current=page(client,video),grant=await current.ready;
   assert.equal((await client.call(`/api/playback/${grant.id}/heartbeat`,{method:'POST',data:{sequence:1,position:0,playing:false,seeking:false,state:'PAUSED',playedSeconds:0}})).status,200);
   assert.equal(await current.close(),true);
   assert.equal(await db.playbackSession.count({where:{userId:user.id,...app.playback.capacity.active(new Date())}}),0);
  }
 }
 const a=accounts[0].client,b=accounts[1].client,open=[];
 try{
  for(const client of [a,b])for(const video of videos.slice(0,2)){const current=page(client,video);await current.ready;open.push(current);}
  for(const client of [a,b]){const blocked=await client.call('/api/playback/authorize',{method:'POST',data:{videoId:videos[2].publicId,requestId:randomUUID()}});assert.equal(blocked.status,429);assert.equal(blocked.body.code,'VIP_STREAM_LIMIT');}
  const first=await open[0].ready;assert.equal((await b.call(`/api/playback/${first.id}/terminate`,{method:'POST',data:{}})).status,410);
  assert.equal((await db.playbackSession.findUnique({where:{id:first.id}})).revokedAt,null);
  assert.equal(await open[0].close(),true);
  const replacement=page(a,videos[2]);await replacement.ready;open.push(replacement);
 }finally{await Promise.all(open.map(current=>current.close()));}
 for(const {user}of accounts)assert.equal(await db.playbackSession.count({where:{userId:user.id,...app.playback.capacity.active(new Date())}}),0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPlaybackCapacity,lifecycleUpdate} from '../services/api/src/playback-capacity.mjs';
import {isolatedDatabase} from './helpers/playback-database.mjs';
import {hashPassword} from '../services/api/src/domain.mjs';
import {createDatabase} from '../services/api/src/database.mjs';
import {applicationConfig} from '../services/api/src/config.mjs';

test('retired global capacity environment values are ignored',()=>{
 const names=['PLAYBACK_GLOBAL_LIMIT','TELEGRAM_UPSTREAM_LIMIT'],prior=names.map(name=>process.env[name]);
 try{for(const name of names)process.env[name]='1';const config=applicationConfig();assert.equal(Object.hasOwn(config,'playbackLimit'),false);assert.equal(Object.hasOwn(config,'upstreamLimit'),false);assert.ok([1,2].includes(config.sessionUpstreamLimit));}
 finally{names.forEach((name,i)=>{if(prior[i]===undefined)delete process.env[name];else process.env[name]=prior[i];});}
});

test('pause deadline is fixed; recovery and playing deadlines are ninety seconds',()=>{
 const at=new Date('2026-11-03T00:00:00Z'),play={expiresAt:new Date(+at+3600000),state:'PLAYING'};
 const paused=lifecycleUpdate(play,'PAUSED',at);assert.equal(+paused.reservedUntil,+at+600000);
 assert.equal(+lifecycleUpdate({...play,...paused},'PAUSED',new Date(+at+300000)).reservedUntil,+paused.reservedUntil);
 for(const state of ['PLAYING','BUFFERING','DISCONNECTED'])assert.equal(+lifecycleUpdate(play,state,at).reservedUntil,+at+90000);
});

test('Module 5: no global admission caps; account races, lease ownership and cleanup remain safe',{skip:process.env.RUN_DB_TESTS!=='1',timeout:180000},async t=>{
 const db=await isolatedDatabase(t,'hh5_capacity'),otherDB=createDatabase(process.env.DATA_BASE_URL,{schema:db.appSchema});t.after(()=>otherDB.$disconnect());let clock=new Date();
 // Existing deployments can retain any historical cap values. They must have
 // no effect on admission; the per-session parallel request limit still does.
 await db.platformSettings.create({data:{id:'platform',playbackLimit:1,upstreamLimit:1,sessionUpstreamLimit:1}});
 const user=await db.user.create({data:{username:'CapacityFixture',usernameCanonical:'capacityfixture',passwordHash:await hashPassword(randomUUID())}});
 const viewer=await db.viewerSession.create({data:{tokenHash:randomUUID(),expiresAt:new Date(+clock+3600000)}});
 const video=await db.video.create({data:{id:'capacity-fixture',title:'Isolated fixture',filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1000,uploadedAt:clock}});
 const config={playbackLimit:1,upstreamLimit:1};
 const a=createPlaybackCapacity({db,config,production:false,now:()=>clock}),b=createPlaybackCapacity({db:otherDB,config,production:false,now:()=>clock});
 const data=(accessType='VIP')=>({requestKey:randomUUID(),videoId:video.id,viewerId:viewer.id,userId:user.id,accountSessionId:null,accessType,lastHeartbeatAt:clock,lastPosition:0,expiresAt:new Date(+clock+3600000)});
 const reserve=(capacity,input)=>(capacity===b?otherDB:db).$transaction(tx=>capacity.reserve(tx,input),{timeout:15000});
 const firstInput=data(),first=await reserve(a,firstInput);
 await otherDB.platformSettings.findUnique({where:{id:'platform'}});
 // Race for the account's second VIP slot using two independent API clients.
 const vipRace=await Promise.allSettled([reserve(a,data()),reserve(b,data())]);
 assert.equal(vipRace.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(vipRace.filter(r=>r.status==='rejected'&&r.reason.status===429&&r.reason.code==='VIP_STREAM_LIMIT').length,1);
 const second=vipRace.find(r=>r.status==='fulfilled').value;
 assert.equal((await db.playbackSession.findUnique({where:{id:first.id}})).revokedAt,null);
 assert.equal((await reserve(b,firstInput)).id,first.id);
 await assert.rejects(reserve(a,data()),e=>e.status===429&&e.code==='VIP_STREAM_LIMIT');
 const free=await reserve(b,data('FREE'));await reserve(a,data('FREE'));assert.equal(await db.playbackSession.count(),4);
 const otherUser=await db.user.create({data:{username:'OtherViewer',usernameCanonical:'otherviewer',passwordHash:user.passwordHash}});
 await reserve(b,{...data(),userId:otherUser.id});assert.equal(await db.playbackSession.count(),5);
 const lease=randomUUID(),deadline=+clock+60000;
 await a.upstream({sid:first.id},lease,deadline);await b.upstream({sid:first.id},lease,deadline,true);
 await assert.rejects(b.upstream({sid:first.id},randomUUID(),deadline),e=>e.status===503&&e.code==='SESSION_UPSTREAM_LIMIT');
 await b.upstream({sid:second.id},randomUUID(),deadline);
 await a.upstream({sid:free.id},randomUUID(),deadline);
 assert.equal(await db.upstreamLease.count({where:{kind:'MEDIA'}}),3);
 await assert.rejects(b.upstream({sid:free.id},lease,deadline),e=>e.status===403);
 const discovery=randomUUID();await b.discovery(discovery);
 await assert.rejects(a.discovery(randomUUID()),e=>e.code==='BACKGROUND_BUSY');
 const releaseMetadata=await a.metadata(randomUUID());
 await assert.rejects(b.metadata(randomUUID()),e=>e.code==='BACKGROUND_BUSY');await releaseMetadata();
 const paused=lifecycleUpdate(first,'PAUSED',clock);await db.playbackSession.update({where:{id:first.id},data:paused});
 clock=new Date(+clock+91000);await a.cleanup();await b.cleanup();
 assert.equal((await db.playbackSession.findUnique({where:{id:first.id}})).state,'PAUSED');
 assert.equal((await db.playbackSession.findUnique({where:{id:second.id}})).state,'EXPIRED');
 assert.equal(await db.upstreamLease.count(),0);assert.equal(await db.playbackSession.count(),5);
 await assert.rejects(a.upstream({sid:first.id},lease,+clock+60000,true),e=>e.status===403);
 await reserve(b,data());assert.equal(await db.playbackSession.count(),6);
 // Different Free viewers never race for an arbitrary global last slot.
 const racing=await Promise.allSettled([reserve(a,data('FREE')),reserve(b,data('FREE'))]);
 assert.equal(racing.filter(r=>r.status==='fulfilled').length,2);
 assert.equal(await db.playbackSession.count(),8);
 const legacy=await db.platformSettings.findUnique({where:{id:'platform'}});assert.equal(legacy.playbackLimit,1);assert.equal(legacy.upstreamLimit,1);
});

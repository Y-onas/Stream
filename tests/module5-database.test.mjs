import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {HttpError} from '../services/api/src/domain.mjs';
import {isolatedDatabase,httpClient} from './helpers/playback-database.mjs';
import {buildPlaybackFixture} from './helpers/build-playback-fixture.mjs';

test('Module 5: persistent lifecycle, actual Go streams, administration and multi-device revocation',{skip:process.env.RUN_DB_TESTS!=='1',timeout:480000},async t=>{
 const fixture=buildPlaybackFixture(),db=await isolatedDatabase(t,'hh5_flow'),directory=await mkdtemp(path.join(tmpdir(),'hh5-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}),publicPath=path.join(directory,'public.pem');await writeFile(publicPath,publicKey);
 const config={bootstrapEmail:'owner@example.test',bootstrapName:'Disposable owner',currency:'ETB',supportUsername:'',timezone:'Africa/Nairobi',adminOrigin:'http://admin.test',playbackPrivateKey:privateKey,playbackPublicKey:publicKey,playbackTTL:300,sessionUpstreamLimit:2};
 await seedPlans(db,'ETB');await bootstrapAdministration(db,config);const owner=await db.administrator.findUnique({where:{email:'owner@example.test'}});
 // Legacy settings remain persisted but cannot restrict global admission.
 await db.platformSettings.update({where:{id:'platform'},data:{playbackLimit:1,upstreamLimit:1,sessionUpstreamLimit:2}});
 const videos=[];for(let n=0;n<3;n++)videos.push(await db.video.create({data:{id:`private-fixture-${n}`,title:`Disposable video ${n}`,filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:2*1024*1024+57,uploadedAt:new Date(),durationSeconds:120,accessType:n===2?'FREE':'VIP'}}));
 let offset=0,goOrigin,heldIssue=null;const applications=[],servers=[];
 // Hold only the final authorization write to deterministically exercise a
 // real PostgreSQL termination between policy checking and grant issuance.
 const applicationDB=new Proxy(db,{get(target,key){
  if(key==='$executeRaw')return async(...args)=>{
   const held=heldIssue;
   if(held&&args[0].some?.(part=>part.includes('SET "authorizedUntil"'))&&args.includes(held.id)){
    heldIssue=null;held.reached();await held.resume;
   }
   return target.$executeRaw(...args);
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 for(let n=0;n<2;n++){
  const app=createApplication({db:applicationDB,config,now:()=>new Date(Date.now()+offset),adminAuth:async req=>{if(req.headers.authorization==='Bearer test-owner')return owner;if(req.headers.authorization==='Bearer test-admin')return {...owner,role:'ADMIN'};throw new HttpError(401,'Unauthorized');}});applications.push(app);
  const handler=createAPI({streamOrigin:'http://go-fixture',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',application:app,thumbnails:{get:()=>({status:'unavailable'}),close(){}},fetcher:(url,options)=>fetch(new URL(url.pathname,goOrigin),options)});
  const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);t.after(()=>{server.closeAllConnections();server.close();});
 }
 t.after(async()=>{await Promise.all(applications.map(app=>app.close()));});
 const origins=servers.map(s=>`http://127.0.0.1:${s.address().port}`),child=spawn(fixture,['-check-url',origins[0]+'/internal/playback/check','-public-key',publicPath,'-part-delay','100ms'],{env:{...process.env,STREAM_SERVICE_TOKEN:'s'.repeat(40)},stdio:['ignore','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
 goOrigin=await new Promise((resolve,reject)=>{let text='';child.once('error',reject);child.stdout.on('data',bytes=>{text+=bytes;const line=text.split('\n')[0].trim();if(/^http:\/\/127\.0\.0\.1:\d+$/.test(line))resolve(line);});child.once('exit',code=>reject(Error('Go fixture exited '+code)));});
 const a=httpClient(origins[0]),b=httpClient(origins[1]),c=httpClient(origins[0]),visitor=httpClient(origins[1]),admin=httpClient(origins[0],{admin:true}),moderator=httpClient(origins[0],{adminToken:'test-admin'});
 const password='Disposable account password 123!',nextPassword='New disposable password 456!';let user,ga,gb,gf,gv;
 const auth=(client,video,extra={})=>client.call('/api/playback/authorize',{method:'POST',data:{videoId:video.publicId,requestId:randomUUID(),...extra}});
 const end=(client,grant)=>client.call(`/api/playback/${grant.id}/terminate`,{method:'POST',data:{}});
 const okay=result=>assert.equal(result.status,201,JSON.stringify(result.body));
 const paused=async(client,grant)=>{const result=await client.call(`/api/playback/${grant.id}/heartbeat`,{method:'POST',data:{sequence:1,position:0,playing:false,seeking:false,state:'PAUSED',playedSeconds:0}});assert.equal(result.status,200,JSON.stringify(result.body));};

 await t.test('two VIP devices per account and independent signed-in/anonymous Free viewers',async()=>{
  assert.equal((await a.call('/api/auth/register',{method:'POST',data:{username:'Module5Viewer',password}})).status,201);
  user=await db.user.findUnique({where:{usernameCanonical:'module5viewer'}});
  await db.membership.create({data:{userId:user.id,planId:'monthly',planName:'Disposable approved fixture',durationMonths:1,amountMinor:99000,currency:'ETB',activatedAt:new Date(),expiresAt:new Date(Date.now()+3600000),approvedByAdminId:owner.id,source:'MANUAL'}});
  for(const client of [b,c])assert.equal((await client.call('/api/auth/login',{method:'POST',data:{username:'Module5Viewer',password}})).status,200);
  const requestId=randomUUID(),first=await auth(a,videos[0],{requestId});okay(first);ga=first.body;await paused(a,ga);
  const second=await auth(b,videos[1]);okay(second);gb=second.body;await paused(b,gb);
  assert.equal((await auth(c,videos[0])).body.code,'VIP_STREAM_LIMIT');
  const free=await auth(c,videos[2]);okay(free);gf=free.body;await paused(c,gf);
  const anonymous=await auth(visitor,videos[2]);okay(anonymous);gv=anonymous.body;await paused(visitor,gv);
  assert.equal((await auth(a,videos[0],{requestId})).body.id,ga.id);
  assert.equal((await auth(a,videos[0],{sessionId:ga.id})).body.id,ga.id);
  assert.equal(await db.playbackSession.count({where:{revokedAt:null}}),4);
  for(const grant of [ga,gb])assert.equal((await db.playbackSession.findUnique({where:{id:grant.id}})).revokedAt,null);
 });
 await t.test('three open media streams and another range pass the retired global reservation cap',async()=>{
  const responses=[await a.request(ga.streamUrl),await b.request(gb.streamUrl),await c.request(gf.streamUrl)];
  const readers=responses.map(response=>{assert.equal(response.status,200);return response.body.getReader();});
  try{
   for(const reader of readers)assert.ok((await reader.read()).value.length);
   assert.equal(await db.upstreamLease.count({where:{kind:'MEDIA',expiresAt:{gt:new Date()}}}),3);
   const extra=await visitor.call(gv.streamUrl,{headers:{Range:'bytes=0-10'}});assert.equal(extra.status,206);assert.equal(extra.body.length,11);
   for(const reader of readers)assert.ok((await reader.read()).value.length);
  }finally{await Promise.allSettled(readers.map(reader=>reader.cancel()));}
  for(let n=0;n<20;n++){if(!await db.upstreamLease.count({where:{kind:'MEDIA',expiresAt:{gt:new Date()}}}))break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.equal(await db.upstreamLease.count({where:{kind:'MEDIA',expiresAt:{gt:new Date()}}}),0);assert.equal(await db.videoView.count(),0);
 });
 await t.test('scoped cookies, cross-video binding, admin termination and audit safety',async()=>{
  for(const grant of [ga,gb])assert.ok(grant.streamUrl.includes(grant.id));
  assert.notEqual(a.cookie('hh_playback',ga.streamUrl),b.cookie('hh_playback',gb.streamUrl));
  const wrong=await fetch(goOrigin+`/internal/videos/${videos[1].publicId}/stream`,{headers:{Authorization:'Bearer '+'s'.repeat(40),'X-Playback-Grant':a.cookie('hh_playback',ga.streamUrl)}});assert.equal(wrong.status,401);
  assert.equal((await visitor.call('/api/admin/playback-sessions',{headers:{Origin:'http://admin.test'}})).status,401);
  const listing=await admin.call('/api/admin/playback-sessions');assert.equal(listing.status,200);assert.equal(listing.body.total,4);assert.ok(!JSON.stringify(listing.body).includes('private-fixture'));
  assert.equal((await admin.call(`/api/admin/playback-sessions/${gb.id}/terminate`,{method:'POST',data:{reason:''}})).status,400);
  assert.equal((await moderator.call(`/api/admin/playback-sessions/${gb.id}/terminate`,{method:'POST',data:{reason:'Disposable session-control acceptance'}})).status,200);
  assert.equal((await db.user.findUnique({where:{id:user.id}})).status,'ACTIVE');assert.equal(await db.membership.count({where:{userId:user.id,revokedAt:null}}),1);
  assert.ok([401,403].includes((await b.call(gb.streamUrl,{headers:{Range:'bytes=0-10'}})).status));
  const audit=await db.adminAuditLog.findFirst({where:{action:'PLAYBACK_TERMINATED',targetId:gb.id}});assert.equal(audit.adminId,owner.id);assert.ok(audit.note.includes('Disposable'));
  // The actual HTTP body must be interrupted, not merely future grant issuance.
  const response=await a.request(ga.streamUrl),reader=response.body.getReader();assert.equal(response.status,200);await reader.read();
  assert.equal((await admin.call(`/api/admin/playback-sessions/${ga.id}/terminate`,{method:'POST',data:{reason:'Disposable open-stream termination'}})).status,200);
  await assert.rejects(async()=>{while(!(await reader.read()).done){}});
  await end(c,gf);await end(visitor,gv);
 });
 await t.test('independent progress, qualifications, pause deadlines and recovery expiry',async()=>{
  const first=await auth(a,videos[0]),second=await auth(b,videos[0]);okay(first);okay(second);ga=first.body;gb=second.body;
  offset=30000;
  for(const [client,grant,position]of [[a,ga,20],[b,gb,30]]){const report=await client.call(`/api/playback/${grant.id}/heartbeat`,{method:'POST',data:{sequence:1,position,playing:true,seeking:false,state:'PLAYING',playedSeconds:position}});assert.equal(report.status,200,JSON.stringify(report.body));}
  assert.equal((await a.call(`/api/me/videos/${videos[0].publicId}/progress`)).body.progress.position,20);
  assert.equal((await b.call(`/api/me/videos/${videos[0].publicId}/progress`)).body.progress.position,30);
  assert.equal(await db.videoView.count({where:{playbackSessionId:gb.id}}),1);
  const pause=await a.call(`/api/playback/${ga.id}/heartbeat`,{method:'POST',data:{sequence:2,position:20,playing:false,seeking:false,state:'PAUSED',playedSeconds:0}});assert.equal(pause.status,200);
  const paused=await db.playbackSession.findUnique({where:{id:ga.id}});assert.equal(+paused.reservedUntil-+paused.pauseStartedAt,600000);
  offset=7*60000;
  // The original five-minute JWT has expired, but the paused ten-minute
  // reservation must recover with a fresh grant and no extra playback slot.
  const recovered=await auth(a,videos[0],{sessionId:ga.id});okay(recovered);assert.equal(recovered.body.id,ga.id);
  assert.equal(await db.playbackSession.count({where:{userId:user.id,state:'PAUSED',revokedAt:null}}),1);
  offset=11*60000;
  // A scheduled cleanup may already hold the shared lock with the earlier
  // fixture clock. Finish a pass at the advanced time before rewinding it.
  let cleaned;for(let n=0;n<20;n++){cleaned=await applications[0].playback.capacity.cleanup();if(!cleaned.skipped)break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.notEqual(cleaned.skipped,true);
  for(const grant of [ga,gb])assert.equal((await db.playbackSession.findUnique({where:{id:grant.id}})).state,'EXPIRED');
  assert.equal((await auth(a,videos[0],{sessionId:ga.id})).status,410);
  offset=0; // Actual Go checks use real time; further grants use the real clock.
 });
 await t.test('permanent denial releases slots; temporary errors and invalid callers cannot revoke them',async sub=>{
  const cleanupIds=[];sub.after(async()=>{const at=new Date();await db.playbackSession.updateMany({where:{id:{in:cleanupIds},revokedAt:null},data:{state:'TERMINATED',revokedAt:at,authorizedUntil:at,reservedUntil:at}});});
  const first=await auth(a,videos[0]);okay(first);const grant=first.body;cleanupIds.push(grant.id);const member=await db.membership.findFirst({where:{userId:user.id,revokedAt:null}});
  const renew=(client,extra={})=>client.call(`/api/playback/${grant.id}/renew`,{method:'POST',data:{},...extra});
  assert.equal((await renew(a,{headers:{'X-CSRF-Token':'invalid-test-token'}})).status,403);
  assert.equal((await renew(visitor)).status,410);
  assert.equal((await auth(a,videos[1],{sessionId:grant.id})).status,409);
  assert.equal((await auth(visitor,videos[2],{sessionId:grant.id})).status,410);
  assert.equal((await db.playbackSession.findUnique({where:{id:grant.id}})).revokedAt,null);
  await db.video.update({where:{id:videos[0].id},data:{sourceRetryAt:new Date(Date.now()+60000)}});
  try{assert.equal((await renew(a)).status,503);assert.equal((await db.playbackSession.findUnique({where:{id:grant.id}})).revokedAt,null);}
  finally{await db.video.update({where:{id:videos[0].id},data:{sourceRetryAt:null}});}
  assert.equal((await renew(a)).status,200);
  await db.membership.update({where:{id:member.id},data:{revokedAt:new Date()}});
  try{
   const denied=await renew(a);assert.equal(denied.status,403);assert.equal(denied.body.code,'MEMBERSHIP_REQUIRED');
   const record=await db.playbackSession.findUnique({where:{id:grant.id}});assert.equal(record.state,'TERMINATED');assert.ok(record.revokedAt);assert.ok(record.reservedUntil<=new Date());
   assert.ok(denied.headers.getSetCookie().some(value=>value.includes('Max-Age=0')));
   assert.equal((await renew(a)).status,410);
  }finally{await db.membership.update({where:{id:member.id},data:{revokedAt:null}});}
  // Signed-in Free requests also require CSRF. Anonymous Free remains public.
  assert.equal((await a.call('/api/playback/authorize',{method:'POST',data:{videoId:videos[2].publicId,requestId:randomUUID()},headers:{'X-CSRF-Token':'bad'}})).status,403);
  const hidden=await auth(a,videos[0]);okay(hidden);cleanupIds.push(hidden.body.id);
  await db.video.update({where:{id:videos[0].id},data:{published:false}});
  try{
   assert.equal((await a.call(`/api/playback/${hidden.body.id}/heartbeat`,{method:'POST',data:{sequence:1,position:0,playing:false,seeking:false,state:'PAUSED',playedSeconds:0}})).status,404);
   assert.equal((await db.playbackSession.findUnique({where:{id:hidden.body.id}})).state,'TERMINATED');
  }finally{await db.video.update({where:{id:videos[0].id},data:{published:true}});}
  const expiring=await auth(a,videos[0]);okay(expiring);cleanupIds.push(expiring.body.id);const session=await db.playbackSession.findUnique({where:{id:expiring.body.id}});
  await db.userSession.update({where:{id:session.accountSessionId},data:{expiresAt:new Date(Date.now()-1000)}});
  assert.equal((await a.call(`/api/playback/${session.id}/renew`,{method:'POST',data:{}})).status,401);
  assert.equal((await db.playbackSession.findUnique({where:{id:session.id}})).state,'TERMINATED');
  assert.equal((await a.call('/api/auth/login',{method:'POST',data:{username:'Module5Viewer',password}})).status,200);
 });
 await t.test('termination during renewal cannot issue another live grant',async()=>{
  const first=await auth(a,videos[0]);okay(first);const grant=first.body;
  let reached,release;const atWrite=new Promise(resolve=>{reached=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  heldIssue={id:grant.id,reached,resume};const renewal=a.call(`/api/playback/${grant.id}/renew`,{method:'POST',data:{}});
  try{
   await Promise.race([atWrite,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Renewal did not reach the authorization gate')),20000);timer.unref();atWrite.finally(()=>clearTimeout(timer));})]);
   assert.equal((await admin.call(`/api/admin/playback-sessions/${grant.id}/terminate`,{method:'POST',data:{reason:'Termination during a delayed authorization acceptance test'}})).status,200);
  }finally{heldIssue=null;release();}
  const denied=await renewal;assert.equal(denied.status,410);
  assert.ok(!denied.headers.getSetCookie().some(value=>value.startsWith('hh_playback=')&&!value.includes('Max-Age=0')));
  const record=await db.playbackSession.findUnique({where:{id:grant.id}});assert.ok(record.revokedAt);assert.ok(record.authorizedUntil<=record.revokedAt);
  assert.equal((await a.request(grant.streamUrl,{method:'HEAD'})).status,401);
 });
 await t.test('single-device logout preserves the other device; password change and logout-all revoke all',async()=>{
  const first=await auth(a,videos[0]),second=await auth(b,videos[1]);okay(first);okay(second);ga=first.body;gb=second.body;
  assert.equal((await b.call('/api/auth/logout',{method:'POST',data:{}})).status,200);
  assert.equal((await db.playbackSession.findUnique({where:{id:ga.id}})).revokedAt,null);
  assert.ok((await db.playbackSession.findUnique({where:{id:gb.id}})).revokedAt);
  assert.equal((await a.call(ga.streamUrl,{method:'HEAD'})).status,200);
  assert.equal((await a.call('/api/auth/password',{method:'POST',data:{currentPassword:password,newPassword:nextPassword}})).status,200);
  assert.equal(await db.userSession.count({where:{userId:user.id}}),0);assert.ok((await db.playbackSession.findUnique({where:{id:ga.id}})).revokedAt);
  for(const client of [a,b])assert.equal((await client.call('/api/auth/login',{method:'POST',data:{username:'Module5Viewer',password:nextPassword}})).status,200);
  ga=(await auth(a,videos[0])).body;gb=(await auth(b,videos[1])).body;
  assert.equal((await a.call('/api/auth/logout-everywhere',{method:'POST',data:{}})).status,200);
  assert.equal(await db.userSession.count({where:{userId:user.id}}),0);assert.equal(await db.playbackSession.count({where:{userId:user.id,revokedAt:null,state:{not:'EXPIRED'}}}),0);
 });
 await t.test('origins, bounded security events, private caching and operations permissions',async()=>{
  const denied=await visitor.call('/api/playback/authorize',{method:'POST',data:{videoId:videos[2].publicId},headers:{Origin:'http://untrusted.test'}});assert.equal(denied.status,403);
  await applications[0].security.flush();await applications[1].security.flush();
  const events=await admin.call('/api/admin/security-events');assert.equal(events.status,200);assert.ok(events.body.items.some(e=>e.kind==='VIP_STREAM_LIMIT'));
  assert.equal((await moderator.call('/api/admin/security-events')).status,403);assert.equal((await moderator.call('/api/admin/operations')).status,403);
  const attacker=httpClient(origins[0]);let last;
  for(let n=0;n<=180;n++){last=await attacker.call(`/api/playback/${randomUUID()}/stream`,{headers:{'X-Client-IP':'198.51.100.7'}});assert.equal(last.status,n<180?401:429);}
  const grant=await auth(visitor,videos[2]);okay(grant);const range=await visitor.call(grant.body.streamUrl,{headers:{Range:'bytes=10-19'}});assert.equal(range.status,206);assert.equal(range.headers.get('cache-control'),'private, no-store');assert.equal(range.body.length,10);
  await end(visitor,grant.body);
 });
 await t.test('published Free titles have no new maximum; legacy cap data stays intact',async()=>{
  for(let n=0;n<2;n++)await db.video.create({data:{id:'free-extra-'+n,title:'Free fixture '+n,filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1000,uploadedAt:new Date(),accessType:'FREE'}});
  const catalogue=await visitor.call('/api/videos?access=FREE');assert.equal(catalogue.status,200);assert.equal(catalogue.body.items.length,3);
  const settings=await db.platformSettings.findUnique({where:{id:'platform'}});assert.equal(settings.playbackLimit,1);assert.equal(settings.upstreamLimit,1);
 });
});

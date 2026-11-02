import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {SignJWT,importPKCS8,decodeJwt} from 'jose';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {importCatalogue} from '../services/api/src/catalogue-sync.mjs';
import {HttpError} from '../services/api/src/domain.mjs';
import {isolatedDatabase,httpClient} from './helpers/playback-database.mjs';
import {buildPlaybackFixture} from './helpers/build-playback-fixture.mjs';

test('Module 4.3: PostgreSQL + Node-signed grants + actual Go verifier and Range handler',{skip:process.env.RUN_DB_TESTS!=='1',timeout:360000},async t=>{
 const fixture=buildPlaybackFixture();
 const db=await isolatedDatabase(t),directory=await mkdtemp(path.join(tmpdir(),'hh43-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}),publicPath=path.join(directory,'public.pem');await writeFile(publicPath,publicKey);
 const config={bootstrapEmail:'owner@example.test',bootstrapName:'Isolated owner',currency:'ETB',supportUsername:'example_human',timezone:'Africa/Nairobi',adminOrigin:'http://admin.test',playbackPrivateKey:privateKey,playbackPublicKey:publicKey,playbackTTL:300};
 await seedPlans(db,'ETB');await bootstrapAdministration(db,config);const owner=await db.administrator.findUnique({where:{email:'owner@example.test'}});
 const source=[1,2,3].map(n=>({id:`channel-43-${n}`,filename:`fixture-${n}.mp4`,title:`Module 4.3 isolated ${n}`,mimeType:'video/mp4',sizeBytes:2*1024*1024+57,uploadedAt:new Date().toISOString(),durationSeconds:120}));await importCatalogue(db,{items:source,sync:{initialComplete:true}});
 const vip=await db.video.findUnique({where:{id:source[0].id}}),free=await db.video.findUnique({where:{id:source[1].id}}),hidden=await db.video.findUnique({where:{id:source[2].id}});
 assert.equal(vip.accessType,'VIP');await db.video.update({where:{id:free.id},data:{accessType:'FREE'}});await db.video.update({where:{id:hidden.id},data:{published:false}});
 let clock=new Date(),goOrigin;
 const app=createApplication({db,config,now:()=>clock,adminAuth:async req=>{if(req.headers.authorization!=='Bearer test-owner')throw new HttpError(401,'Unauthorized');return owner;}});
 const handler=createAPI({streamOrigin:'http://go-fixture',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',application:app,thumbnails:{get:()=>({status:'unavailable'}),close(){}},fetcher:(url,options)=>fetch(new URL(url.pathname,goOrigin),options)}),server=http.createServer(handler);
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(fixture,['-check-url',origin+'/internal/playback/check','-public-key',publicPath,'-part-delay','15ms'],{env:{...process.env,STREAM_SERVICE_TOKEN:'s'.repeat(40)},stdio:['ignore','pipe','pipe'],windowsHide:true});
 t.after(()=>{child.kill();});goOrigin=await new Promise((resolve,reject)=>{let text='';child.once('error',reject);child.stdout.on('data',data=>{text+=data;const line=text.split('\n')[0].trim();if(/^http:\/\/127\.0\.0\.1:\d+$/.test(line))resolve(line);});child.once('exit',code=>reject(Error('Go fixture exited: '+code)));});
 const visitor=httpClient(origin),buyer=httpClient(origin),admin=httpClient(origin,{admin:true});let approvedMembership;
 const authorize=(client,video)=>client.call('/api/playback/authorize',{method:'POST',data:{videoId:video.publicId,position:0}});
 const videoEdit=async(video,changes)=>{const current=(await admin.call(`/api/admin/videos/${video.id}`)).body;const result=await admin.call(`/api/admin/videos/${video.id}`,{method:'POST',data:{version:current.version,title:current.titleOverride,description:current.descriptionOverride,published:current.published,unavailable:current.adminUnavailable,accessType:current.accessType,reason:'Isolated Module 4.3 validation',...changes}});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};

 await t.test('public metadata is opaque; anonymous Free access works and VIP is denied',async()=>{
  const catalogue=await visitor.call('/api/videos');assert.equal(catalogue.status,200);assert.equal(catalogue.body.items.length,2);assert.ok(!JSON.stringify(catalogue.body).includes('channel-43'));
  assert.equal((await visitor.call(`/api/videos/${vip.publicId}`)).status,200);assert.equal((await visitor.call(`/api/videos/${hidden.publicId}`)).status,404);
  assert.equal((await authorize(visitor,vip)).status,401);const grant=await authorize(visitor,free);assert.equal(grant.status,201);assert.equal(grant.body.accessType,'FREE');
  assert.match(grant.headers.getSetCookie().join(';'),/HttpOnly/);assert.match(grant.headers.getSetCookie().join(';'),/SameSite=Strict/);assert.ok(!JSON.stringify(grant.body).includes('eyJ'));
  const stream=await visitor.call(grant.body.streamUrl,{headers:{Range:'bytes=100-199'}});assert.equal(stream.status,206);assert.equal(stream.headers.get('content-range'),`bytes 100-199/${source[0].sizeBytes}`);assert.deepEqual(stream.body,Buffer.from(Array.from({length:100},(_,i)=>(i+100)%251)));
  assert.equal((await visitor.call(`/api/videos/${free.publicId}/stream`)).status,401);assert.equal(await db.videoView.count(),0);
 });
 await t.test('only real administrator approval enables VIP and intended video survives the request',async()=>{
  const registered=await buyer.call('/api/auth/register',{method:'POST',data:{username:'Module43Buyer',password:'A strong isolated test password'}});assert.equal(registered.status,201);
  assert.equal((await authorize(buyer,vip)).status,403);
  const request=await buyer.call('/api/subscription-requests',{method:'POST',data:{planId:'monthly',videoId:vip.publicId,amountMinor:1}});assert.equal(request.status,201);assert.equal(request.body.videoId,vip.publicId);assert.equal(request.body.amountMinor,99000);
  const approved=await admin.call(`/api/admin/subscription-requests/${request.body.id}`,{method:'POST',data:{action:'approve',version:0,manualPaymentConfirmed:true,note:'Disposable manual-proof fixture; no real payment'}});assert.equal(approved.status,200);approvedMembership=approved.body.membership;
  const grant=await authorize(buyer,vip);assert.equal(grant.status,201,JSON.stringify(grant.body));
  for(const [start,end]of [[0,1023],[4090,4105],[1048570,1048590]]){const range=await buyer.call(grant.body.streamUrl,{headers:{Range:`bytes=${start}-${end}`}});assert.equal(range.status,206);assert.deepEqual(range.body,Buffer.from(Array.from({length:end-start+1},(_,i)=>(i+start)%251)));}
  const head=await buyer.call(grant.body.streamUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers.get('content-length')),source[0].sizeBytes);
  assert.equal((await buyer.call(grant.body.streamUrl,{headers:{Range:'bytes=999999999-'}})).status,416);
  const renewed=await buyer.call(`/api/playback/${grant.body.id}/renew`,{method:'POST',data:{}});assert.equal(renewed.status,200);assert.equal(renewed.body.streamUrl,grant.body.streamUrl);
 });
 await t.test('Go and Node reject missing, forged, expired and wrong-video grants',async()=>{
  const grant=(await authorize(buyer,vip)).body,token=buyer.cookie('hh_playback',grant.streamUrl),claims=decodeJwt(token),goPath=`${goOrigin}/internal/videos/${vip.publicId}/stream`,goHeaders={Authorization:'Bearer '+'s'.repeat(40),'X-Playback-Grant':token,Range:'bytes=0-10'};
  assert.equal((await fetch(goPath,{headers:{Authorization:goHeaders.Authorization}})).status,401);
  assert.equal((await fetch(goPath,{headers:{...goHeaders,'X-Playback-Grant':token.slice(0,-8)+'tampered'}})).status,401);
  assert.equal((await fetch(goPath.replace(vip.publicId,free.publicId),{headers:goHeaders})).status,401);
  const key=await importPKCS8(privateKey,'RS256'),expired=await new SignJWT({...claims,iat:Math.floor(Date.now()/1000)-60,exp:Math.floor(Date.now()/1000)-1}).setProtectedHeader({alg:'RS256',typ:'JWT'}).sign(key);
  assert.equal((await fetch(goPath,{headers:{...goHeaders,'X-Playback-Grant':expired}})).status,401);
  const stranger=httpClient(origin);stranger.jar.set('hh_playback|'+grant.streamUrl,{name:'hh_playback',path:grant.streamUrl,value:token});assert.equal((await stranger.call(grant.streamUrl)).status,403);
  assert.equal((await fetch(origin+'/internal/playback/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant:token})})).status,401);
 });
 await t.test('classification never publishes hidden videos and immediately rejects old Free grants',async()=>{
  await videoEdit(hidden,{accessType:'FREE'});assert.equal((await db.video.findUnique({where:{id:hidden.id}})).published,false);assert.equal((await authorize(visitor,hidden)).status,404);
  const grant=(await authorize(visitor,free)).body;await videoEdit(free,{accessType:'VIP'});assert.equal((await visitor.call(grant.streamUrl,{headers:{Range:'bytes=0-10'}})).status,403);assert.equal((await authorize(visitor,free)).status,401);
  await videoEdit(free,{accessType:'FREE'});assert.equal((await authorize(visitor,free)).status,201);
  await importCatalogue(db,{items:source,sync:{initialComplete:true}});assert.equal((await db.video.findUnique({where:{id:hidden.id}})).published,false);assert.equal((await db.video.findUnique({where:{id:free.id}})).accessType,'FREE');
 });
 await t.test('qualified Free and VIP views stay separate and only VIP enters Trending',async()=>{
  async function qualify(client,video){const grant=await authorize(client,video);assert.equal(grant.status,201);for(let i=1;i<=6;i++){clock=new Date(+clock+5000);const heartbeat=await client.call(`/api/playback/${grant.body.id}/heartbeat`,{method:'POST',data:{sequence:i,position:i*5,playing:true,seeking:false}});assert.equal(heartbeat.status,200,JSON.stringify(heartbeat.body));}}
  clock=new Date();await qualify(visitor,free);clock=new Date();await qualify(buyer,vip);
  assert.equal(await db.videoView.count({where:{accessType:'FREE'}}),1);assert.equal(await db.videoView.count({where:{accessType:'VIP'}}),1);
  for(const period of ['day','week','month']){const result=await visitor.call(`/api/trending?period=${period}`);assert.equal(result.status,200);assert.deepEqual(result.body.items.map(v=>v.id),[vip.publicId]);}
  const report=await admin.call('/api/admin/analytics?preset=today');assert.equal(report.status,200,JSON.stringify(report.body));assert.equal(report.body.views.free,1);assert.equal(report.body.views.vip,1);assert.equal(report.body.trending.day[0].id,vip.publicId);clock=new Date();
 });
 await t.test('revocation terminates an already-open stream and denies renewal and new requests',async()=>{
  const grant=(await authorize(buyer,vip)).body,response=await buyer.request(grant.streamUrl),reader=response.body.getReader();assert.equal(response.status,200);await reader.read();
  const revoke=await admin.call(`/api/admin/memberships/${approvedMembership.id}/revoke`,{method:'POST',data:{note:'Disposable revocation during open connection'}});assert.equal(revoke.status,200);
  await assert.rejects(async()=>{while(!(await reader.read()).done){}});
  assert.equal((await buyer.call(grant.streamUrl,{headers:{Range:'bytes=0-10'}})).status,403);assert.equal((await buyer.call(`/api/playback/${grant.id}/renew`,{method:'POST',data:{}})).status,403);
 });
 await t.test('membership expiry caps the lease and suspension/logout stop protected sessions',async()=>{
  // Leave room for hosted DB setup; expiry is explicitly advanced after the
  // body opens. Go unit tests independently verify the real hard timer.
  const user=await db.user.findUnique({where:{usernameCanonical:'module43buyer'}}),expiresAt=new Date(Date.now()+60000);clock=new Date();
  const member=await db.membership.create({data:{userId:user.id,planId:'monthly',planName:'Disposable short membership',durationMonths:1,amountMinor:0,currency:'ETB',activatedAt:clock,expiresAt,approvedByAdminId:owner.id,source:'MANUAL'}});
  const grant=await authorize(buyer,vip);assert.equal(grant.status,201);assert.ok(Date.parse(grant.body.expiresAt)<=+expiresAt);
  const response=await buyer.request(grant.body.streamUrl),reader=response.body.getReader();assert.equal(response.status,200);await reader.read();
  // Clock advances for Node's membership policy; Go also enforces the signed lease deadline.
  clock=new Date(+expiresAt+1);await assert.rejects(async()=>{while(!(await reader.read()).done){}});assert.equal((await authorize(buyer,vip)).status,403);
  clock=new Date();await db.membership.update({where:{id:member.id},data:{expiresAt:new Date(Date.now()+600000)}});
  const active=(await authorize(buyer,vip)).body;await db.user.update({where:{id:user.id},data:{status:'SUSPENDED'}});assert.equal((await buyer.call(active.streamUrl,{headers:{Range:'bytes=0-10'}})).status,403);
  assert.equal((await authorize(visitor,free)).status,201);await db.user.update({where:{id:user.id},data:{status:'ACTIVE'}});
  assert.equal((await buyer.call('/api/auth/logout',{method:'POST',data:{}})).status,200);assert.equal((await buyer.call(active.streamUrl,{headers:{Range:'bytes=0-10'}})).status,403);
 });
 console.log(JSON.stringify({event:'module43_acceptance_finished',isolatedSchema:true,actualGoVerifier:true,syntheticMedia:true}));
});

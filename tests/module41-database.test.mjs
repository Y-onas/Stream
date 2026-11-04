import {scenarioClientFactory,testPlaybackConfig} from './helpers/playback-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import '../services/api/src/config.mjs';
import {createDatabase} from '../services/api/src/database.mjs';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {importCatalogue} from '../services/api/src/catalogue-sync.mjs';
import {HttpError} from '../services/api/src/domain.mjs';

// This end-to-end regression makes many sequential remote DB requests. Its
// test deadline does not change the application's bounded query/HTTP deadlines.
test('Module 4.1 PostgreSQL workflow and statistics in an isolated disposable schema',{skip:process.env.RUN_DB_TESTS!=='1',timeout:600000},async t=>{
  const schema=`hh_test_${randomBytes(8).toString('hex')}`;
  assert.match(schema,/^hh_test_[a-f0-9]{16}$/);
  const control=new pg.Client({connectionString:process.env.DATA_BASE_URL,connectionTimeoutMillis:10000});await control.connect();await control.query(`CREATE SCHEMA "${schema}"`);
  let db;const servers=[];
  t.after(async()=>{for(const server of servers){server.closeAllConnections();server.close();}await db?.$disconnect();await control.query(`DROP SCHEMA "${schema}" CASCADE`);await control.end();});
  const migration=await readFile(new URL('../services/api/prisma/migrations/202611020001_module41/migration.sql',import.meta.url),'utf8');await control.query(migration.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));
  const libraryMigration=await readFile(new URL('../services/api/prisma/migrations/202611020002_account_library/migration.sql',import.meta.url),'utf8');await control.query(libraryMigration.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));
  const watchedMigration=await readFile(new URL('../services/api/prisma/migrations/202611020003_account_watched/migration.sql',import.meta.url),'utf8');await control.query(watchedMigration.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));
  const adminMigration=await readFile(new URL('../services/api/prisma/migrations/202611020004_admin_management/migration.sql',import.meta.url),'utf8');await control.query(adminMigration.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));
  const accessMigration=await readFile(new URL('../services/api/prisma/migrations/202611020005_playback_access/migration.sql',import.meta.url),'utf8');await control.query(accessMigration.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));
  const lifecycleMigration=await readFile(new URL('../services/api/prisma/migrations/202611020006_session_lifecycle/migration.sql',import.meta.url),'utf8');await control.query(lifecycleMigration.replace('BEGIN;',`BEGIN; SET LOCAL search_path="${schema}";`));
  db=createDatabase(process.env.DATA_BASE_URL,{schema});await seedPlans(db,'ETB');
  let clock=new Date('2026-11-02T09:00:00Z');
  const videos=[{id:'channel-99-1',title:'Test shorter video',filename:'shorter.mp4',sizeBytes:1000,mimeType:'video/mp4',uploadedAt:'2026-11-01T00:00:00Z',durationSeconds:900},{id:'channel-99-2',title:'Test longer video',filename:'longer.mkv',sizeBytes:2000,mimeType:'video/x-matroska',uploadedAt:'2026-11-02T00:00:00Z',durationSeconds:3000}];
  await importCatalogue(db,{items:videos,sync:{initialComplete:true}});await importCatalogue(db,{items:videos,sync:{initialComplete:true}});assert.equal(await db.video.count(),2);
  await db.video.updateMany({data:{accessType:'FREE'}});
  const go=http.createServer((req,res)=>{if(req.url==='/internal/catalogue'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:videos}));}if(req.url==='/readyz')return res.end('{}');res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':'bytes 0-3/1000','Content-Length':'4'});res.end(Buffer.alloc(4));});go.listen(0,'127.0.0.1');await once(go,'listening');servers.push(go);
  const config={...testPlaybackConfig(),currency:'ETB',supportUsername:'example_human',timezone:'Africa/Nairobi',adminOrigin:'http://admin.test',clerkPublishableKey:'',adminIds:[]};
  const adminAuth=async req=>{if(req.headers.authorization!=='Bearer test-administrator')throw new HttpError(401,'Sign in as administrator.');return{id:'clerk-test-administrator'};};
  const app=createApplication({db,config,now:()=>new Date(clock),adminAuth});
  const handler=createAPI({streamOrigin:`http://127.0.0.1:${go.address().port}`,streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',application:app,thumbnails:{get:()=>({status:'unavailable'}),close(){}}});
  const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);const root=`http://127.0.0.1:${server.address().port}`;
  const scenarioClient=await scenarioClientFactory(db,root);const client=admin=>scenarioClient(admin?'test-administrator':undefined);
  const visitor=client(),buyer=client(),racer=client(),admin=client(true);
  assert.equal((await visitor.call('/api/videos')).status,200);assert.equal((await visitor.call('/api/auth/me')).body.user,null);
  assert.equal((await visitor.call('/api/admin/overview')).status,403);
  assert.equal((await admin.call('/api/admin/overview',{headers:{Authorization:''}})).status,401);
  const plans=(await visitor.call('/api/plans')).body.items;assert.deepEqual(plans.map(p=>[p.name,p.priceMinor,p.currency]),[['Monthly',99000,'ETB'],['Yearly',299000,'ETB'],['Long-term',600000,'ETB']]);
  const credentials={username:'ModuleTestBuyer',password:'This is a strong test password'};
  const registration=await Promise.all([buyer.call('/api/auth/register',{method:'POST',data:credentials}),racer.call('/api/auth/register',{method:'POST',data:{...credentials,username:'moduletestbuyer'}})]);
  // Password work has a one-job memory bound. A racing signup may receive a
  // controlled busy response; once the first completes, retry must still
  // enforce the database's case-insensitive username uniqueness.
  for(let i=0;i<registration.length;i++)if(registration[i].status===503)registration[i]=await [buyer,racer][i].call('/api/auth/register',{method:'POST',data:credentials});
  assert.deepEqual(registration.map(r=>r.status).sort(),[201,409]);
  assert.equal((await buyer.call('/api/auth/login',{method:'POST',data:{...credentials,username:'MODULETESTBUYER'}})).status,200);
  assert.equal((await buyer.call('/api/auth/login',{method:'POST',data:{...credentials,password:'An incorrect test password'}})).status,401);
  assert.equal((await visitor.call('/api/auth/username?username=moduletestbuyer')).body.available,false);
  const user=await db.user.findUnique({where:{usernameCanonical:'moduletestbuyer'}});assert.ok(user.passwordHash.startsWith('scrypt$'));assert.ok(!user.passwordHash.includes(credentials.password));
  const otherUser=client();assert.equal((await otherUser.call('/api/auth/register',{method:'POST',data:{username:'OtherLibraryUser',password:credentials.password}})).status,201);
  assert.equal((await visitor.call('/api/me/library')).status,401);assert.equal((await visitor.call('/api/me/videos?kind=liked')).status,401);
  assert.deepEqual((await buyer.call('/api/me/library')).body.counts,{liked:0,saved:0,watched:0});assert.equal((await buyer.call('/api/me/library')).body.userId,user.id);
  assert.equal((await buyer.call('/api/me/profile',{method:'POST',data:{displayName:'Real account display name',username:'CannotChangeIdentity'}})).status,200);
  assert.equal((await buyer.call('/api/auth/me')).body.user.displayName,'Real account display name');assert.equal((await buyer.call('/api/auth/me')).body.user.username,user.username);
  assert.equal((await otherUser.call('/api/auth/me')).body.user.displayName,null);
  assert.equal((await buyer.call('/api/me/videos/channel-99-1/liked',{method:'POST',data:{selected:true},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  for(const kind of ['liked','saved']){
    assert.equal((await buyer.call(`/api/me/videos/channel-99-1/${kind}`,{method:'POST',data:{selected:true,userId:'untrusted-browser-user'}})).status,200);
    assert.equal((await buyer.call(`/api/me/videos/channel-99-1/${kind}`,{method:'POST',data:{selected:true}})).status,200);
    assert.equal((await buyer.call(`/api/me/videos?kind=${kind}`)).body.items[0].id,'channel-99-1');
    assert.equal((await otherUser.call(`/api/me/videos?kind=${kind}`)).body.total,0);
    await otherUser.call(`/api/me/videos/channel-99-1/${kind}`,{method:'POST',data:{selected:true}});
    await otherUser.call(`/api/me/videos/channel-99-1/${kind}`,{method:'POST',data:{selected:false}});
    assert.equal((await buyer.call(`/api/me/videos?kind=${kind}`)).body.total,1);
  }
  assert.deepEqual((await buyer.call('/api/me/library')).body.counts,{liked:1,saved:1,watched:0});
  assert.deepEqual((await otherUser.call('/api/me/library')).body.counts,{liked:0,saved:0,watched:0});
  assert.equal((await buyer.call('/api/me/videos/missing/liked',{method:'POST',data:{selected:true}})).status,404);
  assert.equal((await otherUser.call('/api/me/membership')).body.current,null);
  assert.equal((await visitor.call('/api/subscription-requests',{method:'POST',data:{planId:'yearly'}})).status,401);
  assert.equal((await buyer.call('/api/subscription-requests',{method:'POST',data:{planId:'missing'}})).status,400);
  assert.equal((await buyer.call('/api/subscription-requests',{method:'POST',data:{planId:'yearly'},headers:{'X-CSRF-Token':'invalid'}})).status,403);
  const requests=await Promise.all([buyer.call('/api/subscription-requests',{method:'POST',data:{planId:'yearly',amountMinor:1}}),buyer.call('/api/subscription-requests',{method:'POST',data:{planId:'yearly'}})]);
  assert.equal(requests[0].status,201);assert.equal(requests[0].body.id,requests[1].body.id);const request=requests[0].body;
  assert.equal(request.amountMinor,299000);assert.equal(request.handoff.manualSendRequired,true);assert.equal(new URL(request.handoff.url).pathname,'/example_human');assert.ok(request.handoff.message.includes('@'+user.username));assert.ok(request.handoff.message.includes(request.reference));assert.equal('internalNote' in request,false);
  assert.equal((await visitor.call(`/api/subscription-requests/${request.reference}`)).status,401);
  const found=await admin.call(`/api/admin/subscription-requests?q=${request.reference}`);assert.equal(found.body.items.length,1);
  assert.equal((await admin.call(`/api/admin/subscription-requests/${request.id}`,{method:'POST',data:{action:'approve',version:0}})).status,400);
  const verified=await admin.call(`/api/admin/subscription-requests/${request.id}`,{method:'POST',data:{action:'verify',version:0,manualPaymentConfirmed:true,note:'Isolated test verification; no real payment'}});assert.equal(verified.status,200);
  const approved=await Promise.all([1,2].map(()=>admin.call(`/api/admin/subscription-requests/${request.id}`,{method:'POST',data:{action:'approve',version:1,manualPaymentConfirmed:true,note:'Isolated test approval; no real payment'}})));assert.ok(approved.every(r=>r.status===200));assert.equal(await db.membership.count(),1);assert.equal(await db.adminAuditLog.count({where:{action:'SUBSCRIPTION_APPROVED'}}),1);
  const membership=await db.membership.findFirst();assert.equal(membership.activatedAt.toISOString(),'2026-11-02T09:00:00.000Z');assert.equal(membership.expiresAt.toISOString(),'2027-11-02T09:00:00.000Z');assert.equal((await buyer.call('/api/me/membership')).body.current.status,'ACTIVE');
  const monthly=(await buyer.call('/api/subscription-requests',{method:'POST',data:{planId:'monthly'}})).body;assert.equal((await admin.call(`/api/admin/subscription-requests/${monthly.id}`,{method:'POST',data:{action:'reject',version:0,note:'Test proof did not match'}})).status,200);assert.equal(await db.membership.count(),1);
  assert.equal((await visitor.call('/api/videos/channel-99-1/thumbnail')).status,404);assert.equal((await visitor.call('/api/videos/channel-99-1/stream',{headers:{Range:'bytes=0-3'}})).status,206);assert.equal(await db.videoView.count(),0);
  async function watch(watcher,{seek=false}={}){const play=await watcher.call('/api/videos/channel-99-1/playback',{method:'POST',data:{position:0}});assert.equal(play.status,201);for(let i=1;i<=6;i++){clock=new Date(+clock+5000);const result=await watcher.call(`/api/playback/${play.body.id}/heartbeat`,{method:'POST',data:{sequence:i,position:seek?500+i*5:i*5,playing:true,seeking:seek}});assert.equal(result.status,200);}return play.body.id;}
  await watch(visitor,{seek:true});assert.equal(await db.videoView.count(),0);
  const play=await watch(visitor);assert.equal(await db.videoView.count(),1);await watch(visitor);assert.equal(await db.videoView.count(),1);
  const duplicate=await visitor.call(`/api/playback/${play}/heartbeat`,{method:'POST',data:{sequence:6,position:30,playing:true,seeking:false}});assert.equal(duplicate.status,200);assert.equal(await db.videoView.count(),1);
  assert.equal((await visitor.call('/api/videos?sort=most-viewed')).body.items[0].id,'channel-99-1');assert.equal((await visitor.call('/api/videos?sort=longest')).body.items[0].id,'channel-99-2');
  const first=(await visitor.call('/api/videos?limit=1')).body,second=(await visitor.call(`/api/videos?limit=1&cursor=${first.nextCursor}`)).body;assert.notEqual(first.items[0].id,second.items[0].id);
  await db.video.create({data:{id:'unknown-duration',title:'Unknown duration',filename:'unknown.mkv',mimeType:'video/x-matroska',sizeBytes:100n,uploadedAt:new Date()}});assert.equal((await visitor.call('/api/videos?sort=longest')).body.items.at(-1).durationSeconds,null);
  const overview=(await admin.call('/api/admin/overview')).body;assert.equal(overview.qualifiedViews,1);assert.equal(overview.viewsToday,1);assert.equal(overview.viewsThisWeek,1);assert.equal(overview.viewsThisMonth,1);
  assert.equal((await admin.call(`/api/admin/users/${user.id}/status`,{method:'POST',data:{status:'SUSPENDED',version:0,note:'Isolated suspension test'}})).status,200);assert.equal((await buyer.call('/api/auth/me')).body.user,null);
  assert.equal((await admin.call(`/api/admin/users/${user.id}/status`,{method:'POST',data:{status:'ACTIVE',version:1,note:'Isolated restoration test'}})).status,200);assert.equal(await db.adminAuditLog.count({where:{action:'ACCOUNT_RESTORED'}}),1);
  assert.equal((await buyer.call('/api/auth/login',{method:'POST',data:credentials})).status,200);
  await watch(buyer);assert.equal(await db.videoView.count({where:{userId:user.id}}),1);
  assert.equal((await buyer.call('/api/me/library')).body.counts.watched,1);assert.equal((await buyer.call('/api/me/videos?kind=watched')).body.items[0].id,'channel-99-1');
  assert.equal((await otherUser.call('/api/me/videos?kind=watched')).body.total,0);
  assert.equal((await visitor.call('/api/auth/login',{method:'POST',data:{username:'OtherLibraryUser',password:credentials.password}})).status,200);
  const beforeHistory=await db.videoView.count();await watch(visitor);assert.equal(await db.videoView.count(),beforeHistory);
  assert.equal((await visitor.call('/api/me/library')).body.counts.watched,1);
  assert.equal((await visitor.call('/api/me/videos?kind=watched')).body.total,1);
  const otherDevice=client();assert.equal((await otherDevice.call('/api/auth/login',{method:'POST',data:credentials})).status,200);await watch(otherDevice);assert.equal(await db.videoView.count({where:{userId:user.id}}),1);
  assert.equal((await admin.call(`/api/admin/memberships/${membership.id}/revoke`,{method:'POST',data:{note:'Isolated revocation test'}})).status,200);assert.equal((await buyer.call('/api/me/membership')).body.current,null);assert.equal(await db.adminAuditLog.count({where:{action:'MEMBERSHIP_REVOKED'}}),1);
  assert.equal((await buyer.call('/api/auth/logout',{method:'POST',data:{}})).status,200);assert.equal((await buyer.call('/api/auth/me')).body.user,null);
  const reopened=createDatabase(process.env.DATA_BASE_URL,{schema});try{assert.equal(await reopened.videoView.count(),2);assert.equal(await reopened.membership.count(),1);}finally{await reopened.$disconnect();}
  console.log(JSON.stringify({event:'module41_database_acceptance_passed',isolatedSchema:true,realPayments:false,clerkLiveLogin:false}));
});

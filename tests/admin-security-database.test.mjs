import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {isolatedDatabase,httpClient,testPlaybackConfig} from './helpers/playback-database.mjs';
import {createAdminAuth} from '../services/api/src/admin-auth.mjs';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';

test('admin protection: real HTTP, official Clerk JWT verification and PostgreSQL role checks',{skip:process.env.RUN_DB_TESTS!=='1',timeout:360000},async t=>{
 const db=await isolatedDatabase(t,'hh_admin_security'),keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const config={...testPlaybackConfig(),bootstrapEmail:'owner@example.test',bootstrapName:'Fixture owner',timezone:'Africa/Nairobi',currency:'ETB',adminOrigin:'http://admin.test',clerkSecretKey:'test-only',clerkPublishableKey:'pk_test_fixture',clerkJwtKey:keys.publicKey.export({type:'spki',format:'pem'})};
 await seedPlans(db,'ETB');await bootstrapAdministration(db,config);
 const owner=await db.administrator.findUnique({where:{email:'owner@example.test'}}),staff=await db.administrator.create({data:{email:'staff@example.test',name:'Fixture staff',role:'ADMIN',status:'ACTIVE',clerkUserId:'user_staff',createdBy:owner.id}});
 await db.video.create({data:{id:'fixture-video',title:'Public fixture',filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1000,uploadedAt:new Date(),accessType:'FREE'}});
 const identities=new Map(['owner','staff','ordinary'].map(name=>['user_'+name,{id:'user_'+name,emailAddresses:[{emailAddress:name+'@example.test',verification:{status:'verified'}}],externalAccounts:[{provider:'oauth_google',emailAddress:name+'@example.test',verification:{status:'verified'}}]}]));
 const sessions=new Map(),adminAuth=createAdminAuth(config,{db,getUser:async id=>identities.get(id),getSession:async id=>sessions.get(id)||{id,userId:id.slice(5),status:'active',expireAt:Date.now()+3600000}});
 const app=createApplication({db,config,adminAuth}),handler=createAPI({streamOrigin:'http://fixture.invalid',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',application:app,thumbnails:{close(){}},fetcher:async()=>Response.json({ready:true})});
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();server.close();await handler.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 function token(name,extra={}){const at=Math.floor(Date.now()/1000),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),data=encode({alg:'RS256',kid:'fixture',typ:'JWT'})+'.'+encode({sub:'user_'+name,sid:'sess_user_'+name,iss:'https://fixture.clerk.accounts.dev',azp:config.adminOrigin,iat:at-1,nbf:at-1,exp:at+1800,...extra});return data+'.'+sign('RSA-SHA256',Buffer.from(data),keys.privateKey).toString('base64url');}
 const client=(name,extra)=>httpClient(origin,{adminToken:token(name,extra)}),ownerClient=client('owner'),staffClient=client('staff',{role:'OWNER'}),ordinary=client('ordinary',{role:'OWNER',email:owner.email}),visitor=httpClient(origin),id=randomUUID();
 const getRoutes=['me','overview','videos','videos/fixture-video','users',`users/${id}`,'subscription-requests',`subscription-requests/${id}`,'memberships',`memberships/${id}`,'comments','plans','analytics','settings','administrators','audit-logs','playback-sessions','security-events','operations','unknown'];
 const mutations=['videos/fixture-video',`users/${id}/status`,`subscription-requests/${id}`,'memberships',`memberships/${id}/change`,`memberships/${id}/revoke`,`comments/${id}`,'settings','plans/monthly','administrators',`administrators/${owner.id}`,`playback-sessions/${id}/terminate`];
 await t.test('every protected GET/mutation rejects unauthenticated and unapproved identities',async()=>{
  for(const [method,routes]of [['GET',getRoutes],['POST',mutations]])for(const route of routes){
   const options={method,...(method==='POST'?{data:{role:'OWNER',adminId:owner.id,userId:owner.id}}:{}),headers:{Origin:config.adminOrigin}};
   const anonymous=await visitor.call('/api/admin/'+route,options);assert.equal(anonymous.status,401,route);assert.ok(!JSON.stringify(anonymous.body).includes(owner.email));
   const denied=await ordinary.call('/api/admin/'+route,options);assert.equal(denied.status,403,route);assert.equal(denied.body.code,'ADMIN_ACCESS_DENIED');assert.ok(!JSON.stringify(denied.body).includes(owner.email));
  }
  assert.equal((await visitor.call('/api/admin',{headers:{Origin:config.adminOrigin}})).status,401);
  const configuration=await visitor.call('/api/admin/config',{headers:{Origin:config.adminOrigin}});assert.equal(configuration.status,200);assert.deepEqual(Object.keys(configuration.body).sort(),['configured','provider','publishableKey']);
 });
 await t.test('OWNER and ADMIN use database roles; every OWNER-only operation rejects fake roles',async()=>{
  assert.equal((await ownerClient.call('/api/admin/me')).body.role,'OWNER');assert.equal((await staffClient.call('/api/admin/me')).body.role,'ADMIN');
  for(const route of ['overview','videos','users','subscription-requests','memberships','comments','plans','analytics','audit-logs','playback-sessions'])assert.equal((await staffClient.call('/api/admin/'+route)).status,200,route);
  for(const route of ['settings','administrators','security-events','operations']){assert.equal((await staffClient.call('/api/admin/'+route)).status,403,route);assert.equal((await ownerClient.call('/api/admin/'+route)).status,200,route);}
  for(const route of ['settings','plans/monthly','administrators',`administrators/${owner.id}`])assert.equal((await staffClient.call('/api/admin/'+route,{method:'POST',data:{role:'OWNER',adminId:owner.id,userId:owner.id}})).status,403,route);
  const protectedOwner=await ownerClient.call(`/api/admin/administrators/${owner.id}`,{method:'POST',data:{name:owner.name,role:'ADMIN',status:'ACTIVE',version:0,reason:'Verify the final owner cannot be removed'}});assert.equal(protectedOwner.status,409);const disabledOwner=await ownerClient.call(`/api/admin/administrators/${owner.id}`,{method:'POST',data:{name:owner.name,role:'OWNER',status:'DISABLED',version:0,reason:'Verify the final owner cannot be disabled'}});assert.equal(disabledOwner.status,409);assert.equal((await db.administrator.findUnique({where:{id:owner.id}})).role,'OWNER');
 });
 await t.test('expired, pending, forged and revoked Clerk sessions fail; disabled approval is immediate',async()=>{
  for(const claims of [{exp:1},{sts:'pending'},{azp:'http://untrusted.test'},{sid:null}])assert.equal((await client('owner',claims).call('/api/admin/me')).status,401);
  assert.equal((await httpClient(origin,{adminToken:'forged-token'}).call('/api/admin/me')).status,401);
  sessions.set('sess_user_owner',{id:'sess_user_owner',userId:'user_owner',status:'revoked',expireAt:Date.now()+60000});assert.equal((await ownerClient.call('/api/admin/me')).status,401);sessions.delete('sess_user_owner');
  await db.administrator.update({where:{id:staff.id},data:{status:'DISABLED'}});assert.equal((await staffClient.call('/api/admin/me')).status,403);await db.administrator.update({where:{id:staff.id},data:{status:'ACTIVE'}});
 });
 await t.test('enrolled OWNER MFA cannot be bypassed by a signed first-factor-only token',async()=>{
  identities.get('user_owner').twoFactorEnabled=true;assert.equal((await ownerClient.call('/api/admin/me')).body.code,'ADMIN_MFA_REQUIRED');assert.equal((await client('owner',{fva:[0,0]}).call('/api/admin/me')).status,200);identities.get('user_owner').twoFactorEnabled=false;
 });
 await t.test('CSRF, normal account flows, public responses and logs do not bypass administrator approval',async()=>{
  const password='Disposable security account password 123!';assert.equal((await visitor.call('/api/auth/register',{method:'POST',data:{username:'SecurityViewer',password,role:'OWNER',clerkUserId:'user_owner'}})).status,201);assert.equal(await db.administrator.count(),2);
  assert.equal((await visitor.call('/api/auth/logout',{method:'POST',data:{}})).status,200);assert.equal((await visitor.call('/api/auth/login',{method:'POST',data:{username:'SecurityViewer',password}})).status,200);
  assert.equal((await visitor.call('/api/admin/me',{headers:{Origin:config.adminOrigin}})).status,401);
  const catalogue=await visitor.call('/api/videos');assert.equal(catalogue.status,200);assert.equal(catalogue.body.items.length,1);assert.ok(!JSON.stringify(catalogue.body).includes(owner.email));
  assert.equal((await ownerClient.call('/api/admin/settings',{method:'POST',data:{role:'OWNER'},headers:{Origin:'http://evil.test'}})).status,403);
  assert.equal((await ownerClient.call('/api/admin/settings',{method:'POST',data:{},headers:{Origin:''}})).status,403);
  const canary='credential-canary-that-must-not-be-logged',logs=[],original=console.log;console.log=(...args)=>logs.push(args.join(' '));try{assert.equal((await httpClient(origin,{adminToken:canary}).call('/api/admin/me')).status,401);}finally{console.log=original;}assert.ok(!logs.join('\n').includes(canary));
  assert.equal((await db.administrator.findUnique({where:{id:staff.id}})).role,'ADMIN');assert.equal(await db.administrator.count({where:{role:'OWNER',status:'ACTIVE'}}),1);
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,username,password,addMonths,supportContact,handoff,HttpError} from '../services/api/src/domain.mjs';
import {createAdminAuth} from '../services/api/src/admin-auth.mjs';
import {generateKeyPairSync,sign} from 'node:crypto';
test('username validation, salted scrypt passwords and calendar expiration',async()=>{
  assert.equal(username('Yonas_42').usernameCanonical,'yonas_42');assert.throws(()=>username('yo'));assert.throws(()=>username('user@example'));assert.throws(()=>password('short'));
  const first=await hashPassword('A long unique test password'),second=await hashPassword('A long unique test password');assert.notEqual(first,second);assert.equal(await verifyPassword('A long unique test password',first),true);assert.equal(await verifyPassword('wrong',first),false);assert.equal(await verifyPassword('test','plain-text'),false);
  assert.equal(addMonths('2028-01-31T12:30:00Z',1).toISOString(),'2028-02-29T12:30:00.000Z');assert.equal(addMonths('2028-02-29T12:30:00Z',12).toISOString(),'2029-02-28T12:30:00.000Z');assert.equal(addMonths('2026-11-02T12:30:00Z',144).getUTCFullYear(),2038);
});
test('Telegram handoff is a direct human conversation draft, not an automatic message',()=>{
  assert.equal(supportContact('https://t.me/example_human'),'example_human');assert.equal(supportContact(''),null);assert.throws(()=>supportContact('12345678'));assert.throws(()=>supportContact('payment_bot'));assert.throws(()=>supportContact('https://evil.example/name'));
  const request={planNameSnapshot:'Yearly',amountMinorSnapshot:299000,currencySnapshot:'ETB',usernameSnapshot:'Yonas',reference:'HH-1234567890ABCDEF'};
  const draft=handoff(request,'example_human'),url=new URL(draft.url);assert.equal(url.origin,'https://t.me');assert.equal(url.pathname,'/example_human');assert.equal(url.searchParams.get('text'),draft.message);assert.ok(draft.message.includes('2,990 ETB'));assert.ok(draft.message.includes('@Yonas'));assert.ok(draft.message.includes(request.reference));assert.equal(draft.manualSendRequired,true);assert.equal(handoff(request,null).url,null);
});

const approved={id:'admin-db-id',email:'allowed@example.test',name:'Owner',role:'OWNER',status:'ACTIVE',clerkUserId:'allowed'};
const googleUser=email=>({emailAddresses:[{emailAddress:email,verification:{status:'verified'}}],externalAccounts:[{provider:'oauth_google',emailAddress:email,verification:{status:'verified'}}]});
const liveSession=async()=>({id:'sess_test',userId:'allowed',status:'active',expireAt:Date.now()+3600000});
const adminDb={administrator:{findUnique:async({where})=>where.email===approved.email||where.clerkUserId===approved.clerkUserId?approved:null}};
test('incomplete administrator authentication configurations fail before verification or identity lookup',async t=>{
  for(const [name,config,db,getUser] of [
    ['JWT key without identity lookup',{clerkJwtKey:'test-only'},adminDb,undefined],
    ['no verification keys',{},adminDb,undefined],
    ['identity lookup without verification keys',{},adminDb,async()=>assert.fail('Identity lookup must not run')],
    ['no database',{clerkSecretKey:'test-only'},undefined,async()=>assert.fail('Identity lookup must not run')],
  ]){
    await t.test(name,async()=>{
      const auth=createAdminAuth({adminOrigin:'https://admin.example',...config},{db,getUser,verify:async()=>assert.fail('Token verification must not run')});
      await assert.rejects(auth({headers:{authorization:'Bearer test-token'}}),error=>{
        assert.ok(error instanceof HttpError);assert.equal(error.status,503);assert.equal(error.message,'Administrator authentication is not configured.');return true;
      });
    });
  }
});

test('Clerk authentication checks the verified Google email against the database, not an environment allowlist',async()=>{
  const config={adminOrigin:'https://admin.example',adminIds:['outsider'],clerkSecretKey:'test-only',clerkPublishableKey:''};let claims={sub:'outsider',sid:'sess_test'},google=true;
  const auth=createAdminAuth(config,{db:adminDb,verify:async(token,options)=>{assert.deepEqual(options.authorizedParties,[config.adminOrigin]);if(token==='invalid')throw Error();return claims;},getSession:async()=>({...await liveSession(),userId:claims.sub}),getUser:async id=>google?googleUser(id+'@example.test'):{externalAccounts:[]}});
  await assert.rejects(auth({headers:{}}),e=>e.status===401);await assert.rejects(auth({headers:{authorization:'Bearer invalid'}}),e=>e.status===401);await assert.rejects(auth({headers:{authorization:'Bearer valid'}}),e=>e.status===403);
  claims={sub:'allowed',sid:'sess_test'};google=false;await assert.rejects(auth({headers:{authorization:'Bearer valid'}}),e=>e.status===403);google=true;assert.equal((await auth({headers:{authorization:'Bearer valid'}})).id,approved.id);
});
test('administrator verification checks an actual RSA signature and authorized origin',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const config={adminOrigin:'https://admin.example',clerkJwtKey:publicKey.export({type:'spki',format:'pem'}),clerkPublishableKey:''};
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  function jwt(azp){const data=encode({alg:'RS256',typ:'JWT',kid:'test'})+'.'+encode({sub:'allowed',sid:'sess_test',iss:'https://test.clerk.accounts.dev',azp,iat:Math.floor(Date.now()/1000)-1,nbf:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+60});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');}
  const auth=createAdminAuth(config,{db:adminDb,getSession:liveSession,getUser:async()=>googleUser(approved.email)});
  assert.equal((await auth({headers:{authorization:`Bearer ${jwt(config.adminOrigin)}`}})).id,approved.id);
  await assert.rejects(auth({headers:{authorization:`Bearer ${jwt('https://untrusted.example')}`}}),e=>e.status===401);
  await assert.rejects(auth({headers:{authorization:`Bearer ${jwt(config.adminOrigin).slice(0,-8)}invalid`}}),e=>e.status===401);
});

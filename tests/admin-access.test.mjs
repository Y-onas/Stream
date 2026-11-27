import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createAdminAuth} from '../services/api/src/admin-auth.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const config={adminOrigin:'http://admin.test',clerkJwtKey:keys.publicKey.export({type:'spki',format:'pem'})};
const owner={id:'owner',email:'owner@example.test',role:'OWNER',status:'ACTIVE',name:'Owner',clerkUserId:'user_owner'};
const user=(id,email)=>({id,twoFactorEnabled:false,emailAddresses:[{emailAddress:email,verification:{status:'verified'}}],externalAccounts:[{provider:'oauth_google',emailAddress:email,verification:{status:'verified'}}]});
export function adminToken(key,sub='user_owner',extra={}){
 const at=Math.floor(Date.now()/1000),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const data=encode({alg:'RS256',kid:'fixture',typ:'JWT'})+'.'+encode({sub,sid:'sess_'+sub,iss:'https://fixture.clerk.accounts.dev',azp:'http://admin.test',iat:at-1,nbf:at-1,exp:at+120,...extra});
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),key).toString('base64url');
}
function fixture(){
 const rows=[{...owner}],users=new Map([['user_owner',user('user_owner',owner.email)]]),sessions=new Map();let links=0;
 const db={administrator:{findUnique:async({where})=>rows.find(row=>Object.entries(where).every(([k,v])=>row[k]===v))||null,updateMany:async({where,data})=>{const row=rows.find(r=>Object.entries(where).every(([k,v])=>r[k]===v));if(!row)return{count:0};Object.assign(row,data);links++;return{count:1};}},adminAuditLog:{create:async()=>{}},$transaction:async run=>run(db)};
 const auth=createAdminAuth(config,{db,getUser:async id=>users.get(id),getSession:async id=>sessions.get(id)||{id,userId:id.slice(5),status:'active',expireAt:Date.now()+3600000}});
 const call=(id='user_owner',extra={})=>auth({headers:{authorization:'Bearer '+adminToken(keys.privateKey,id,extra)},role:'OWNER',userId:'owner'});
 return{call,rows,users,sessions,links:()=>links};
}
test('administrator access requires active database approval, verified Google and an active live Clerk session',async t=>{
 await t.test('ordinary Google user cannot grant themselves OWNER',async()=>{const f=fixture();f.users.set('ordinary',user('ordinary','ordinary@example.test'));await assert.rejects(f.call('ordinary',{role:'OWNER',email:owner.email}),e=>e.status===403&&e.code==='ADMIN_ACCESS_DENIED');assert.equal(f.rows.length,1);});
 await t.test('linked Clerk ID survives an email change without creating another identity',async()=>{const f=fixture();f.users.set('user_owner',user('user_owner','new-address@example.test'));assert.equal((await f.call()).id,owner.id);assert.equal(f.links(),0);});
 await t.test('unlinked approval uses normalized verified Google email once',async()=>{const f=fixture();f.rows[0].clerkUserId=null;f.users.set('user_owner',user('user_owner',' OWNER@Example.TEST '));assert.equal((await f.call()).id,owner.id);assert.equal((await f.call()).id,owner.id);assert.equal(f.links(),1);});
 await t.test('disabled linked record cannot fall back to another approval',async()=>{const f=fixture();f.rows[0].status='DISABLED';f.rows.push({...owner,id:'different',clerkUserId:null});await assert.rejects(f.call(),e=>e.status===403);assert.equal(f.links(),0);});
 await t.test('unverified Google and mismatched verified email are denied',async()=>{const f=fixture(),u=f.users.get('user_owner');u.externalAccounts[0].verification.status='unverified';await assert.rejects(f.call(),e=>e.status===403);u.externalAccounts[0].verification.status='verified';u.emailAddresses[0].emailAddress='different@example.test';await assert.rejects(f.call(),e=>e.status===403);});
 await t.test('pending or non-session tokens and expired JWTs are rejected',async()=>{const f=fixture();for(const claims of [{sts:'pending'},{sid:null},{exp:1},{azp:'https://untrusted.test'}])await assert.rejects(f.call('user_owner',claims),e=>e.status===401);});
 await t.test('impersonation cannot stand in for the approved Google identity',async()=>{const f=fixture();await assert.rejects(f.call('user_owner',{act:{sub:'another_actor'}}),e=>e.status===403);f.sessions.set('sess_user_owner',{id:'sess_user_owner',userId:'user_owner',status:'active',expireAt:Date.now()+60000,actor:{sub:'another_actor'}});await assert.rejects(f.call(),e=>e.status===403);});
 await t.test('revocation, expiry and a different live-session owner fail closed',async()=>{const f=fixture(),id='sess_user_owner';for(const change of [{status:'revoked'},{status:'ended'},{status:'pending'},{expireAt:1},{userId:'someone_else'}]){f.sessions.set(id,{id,userId:'user_owner',status:'active',expireAt:Date.now()+60000,...change});await assert.rejects(f.call(),e=>e.status===401);}});
 await t.test('enrolled OWNER MFA requires signed second-factor evidence',async()=>{const f=fixture();f.users.get('user_owner').twoFactorEnabled=true;for(const claims of [{},{fva:[0,-1]}])await assert.rejects(f.call('user_owner',claims),e=>e.status===403&&e.code==='ADMIN_MFA_REQUIRED');assert.equal((await f.call('user_owner',{fva:[1,0]})).mfaEnabled,true);});
 await t.test('Clerk-banned accounts and unknown database roles are denied',async()=>{const f=fixture();f.users.get('user_owner').banned=true;await assert.rejects(f.call(),e=>e.status===403);f.users.get('user_owner').banned=false;f.rows[0].role='VIEWER';await assert.rejects(f.call(),e=>e.status===403);});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {hashPassword} from '../services/api/src/domain.mjs';
import {isolatedDatabase,httpClient} from './helpers/playback-database.mjs';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
test('login and password changes serialize session creation under the same PostgreSQL user lock',{skip:process.env.RUN_DB_TESTS!=='1',timeout:180000},async t=>{
 const db=await isolatedDatabase(t,'hh_login_race'),originalTransaction=db.$transaction.bind(db);
 const username='LoginRaceViewer',oldPassword='Original disposable password!',newPassword='Changed disposable password!',lastPassword='Final disposable password!';
 const user=await db.user.create({data:{username,usernameCanonical:username.toLowerCase(),passwordHash:await hashPassword(oldPassword)}});
 const app=createApplication({db,config:{timezone:'Africa/Nairobi',currency:'ETB'}}),handler=createAPI({streamOrigin:'http://unused.test',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://viewer.test',application:app,thumbnails:{close(){}}}),server=http.createServer(handler);
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();server.close();db.$transaction=originalTransaction;await handler.close();});
 const current=httpClient(origin),racing=httpClient(origin);
 const login=(client,password)=>client.call('/api/auth/login',{method:'POST',data:{username,password}});
 const change=(client,currentPassword,password)=>client.call('/api/auth/password',{method:'POST',data:{currentPassword,newPassword:password}});
 assert.equal((await login(current,oldPassword)).status,200);
 let beforeLock=null,afterIssue=null,passwordTransaction=null;
 db.$transaction=async(fn,options)=>{
  if(beforeLock){const gate=beforeLock;beforeLock=null;gate.entered.resolve();await gate.release.promise;}
  if(afterIssue){const gate=afterIssue;afterIssue=null;return originalTransaction(async tx=>{const result=await fn(tx);gate.entered.resolve();await gate.release.promise;return result;},options);}
  if(passwordTransaction){passwordTransaction.resolve();passwordTransaction=null;}
  return originalTransaction(fn,options);
 };
 await t.test('password change commits after verification but before login obtains its lock',async()=>{
  const gate={entered:deferred(),release:deferred()};beforeLock=gate;
  const pending=login(racing,oldPassword);
  try{await gate.entered.promise;assert.equal((await change(current,oldPassword,newPassword)).status,200);assert.equal(await db.userSession.count({where:{userId:user.id}}),0);}finally{gate.release.resolve();}
  const result=await pending;assert.equal(result.status,401);assert.equal(racing.cookie('hh_session'),undefined);
  assert.equal(await db.userSession.count({where:{userId:user.id}}),0);
  assert.equal((await login(current,newPassword)).status,200,'unchanged verified hash must still log in');
 });
 await t.test('login commits first and the waiting password change then revokes that new session',async()=>{
  const gate={entered:deferred(),release:deferred()};afterIssue=gate;
  const pendingLogin=login(racing,newPassword);let pendingChange;
  try{await gate.entered.promise;const entered=deferred();passwordTransaction=entered;pendingChange=change(current,newPassword,lastPassword);await entered.promise;}finally{gate.release.resolve();}
  assert.equal((await pendingLogin).status,200);assert.equal((await pendingChange).status,200);
  assert.equal(await db.userSession.count({where:{userId:user.id}}),0);
  assert.equal((await racing.call('/api/auth/me')).body.user,null);
  assert.equal((await login(current,lastPassword)).status,200);
 });
});

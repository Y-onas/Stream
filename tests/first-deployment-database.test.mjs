import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {createDatabase} from '../services/api/src/database.mjs';
import {migrationDatabaseUrl} from '../services/api/src/config.mjs';
const run=promisify(execFile);

test('first deployment: controlled migrate deploy is idempotent; production API starts separately',{skip:process.env.RUN_DB_TESTS!=='1',timeout:240000},async t=>{
 const schema='hh_first_deploy_'+randomBytes(8).toString('hex');assert.match(schema,/^hh_first_deploy_[a-f0-9]{16}$/);
 const direct=new URL(migrationDatabaseUrl(process.env.DATA_BASE_URL,process.env.DATA_BASE_DIRECT_URL)),pooled=new URL(process.env.DATA_BASE_URL);direct.searchParams.set('schema',schema);pooled.searchParams.set('schema',schema);
 const control=new pg.Client({connectionString:direct.toString(),connectionTimeoutMillis:10000});control.on('error',()=>{});await control.connect();await control.query(`CREATE SCHEMA "${schema}"`);
 let db,child;t.after(async()=>{child?.kill();await db?.$disconnect();await control.query(`DROP SCHEMA "${schema}" CASCADE`);await control.end();});
 const directory=await mkdtemp(path.join(tmpdir(),'hh-deploy-api-'));t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));return rm(directory,{recursive:true,force:true});});
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),privatePath=path.join(directory,'private.pem'),publicPath=path.join(directory,'public.pem');await writeFile(privatePath,keys.privateKey.export({type:'pkcs8',format:'pem'}));await writeFile(publicPath,keys.publicKey.export({type:'spki',format:'pem'}));
 const source=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(req.url==='/internal/catalogue'?JSON.stringify({items:[],sync:{initialComplete:false}}):JSON.stringify({ready:true}));});source.listen(0,'127.0.0.1');await once(source,'listening');t.after(()=>{source.closeAllConnections();source.close();});
 const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const env={...process.env,NODE_ENV:'production',DATA_BASE_URL:pooled.toString(),DATA_BASE_DIRECT_URL:direct.toString(),EMAIL:'isolated-owner@example.test',MEMBERSHIP_CURRENCY:'ETB',APP_TIMEZONE:'Africa/Nairobi',PUBLIC_ORIGIN:'https://fixture.example.test',ADMIN_ORIGIN:'https://fixture.example.test',API_HOST:'127.0.0.1',API_PORT:String(port),STREAM_ORIGIN:`http://127.0.0.1:${source.address().port}`,STREAM_SERVICE_TOKEN:randomBytes(32).toString('hex'),API_GATEWAY_TOKEN:randomBytes(32).toString('hex'),CLERK_PUBLIC_KEY:'pk_live_fixture',CLERK_SECRET_KEY:'sk_live_fixture',PLAYBACK_PRIVATE_KEY_PATH:privatePath,PLAYBACK_PUBLIC_KEY_PATH:publicPath,PLAYBACK_PREVIOUS_KEYS_PATH:'',PLAYBACK_KEY_ID:'',DATABASE_POOL_MAX:'4'};

 child=spawn(process.execPath,['scripts/start-production.mjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);child.on('error',()=>{});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),origin=`http://127.0.0.1:${port}`;
 for(let n=0;n<100;n++){if(child.exitCode!==null)assert.fail('Production API exited during startup');try{if((await fetch(origin+'/livez',{signal:AbortSignal.timeout(1000)})).status===200)break;}catch{}await pause(100);}
 const pending=await fetch(origin+'/healthz');assert.equal(pending.status,503);assert.equal((await pending.json()).database,false);
 const untouched=await control.query('SELECT to_regclass($1) AS object',[schema+'.hh_administrators']);assert.equal(untouched.rows[0].object,null,'API startup must not create schema or bootstrap an owner');
 let missingOwner;try{await run(process.execPath,['scripts/db-migrate.mjs'],{env:{...env,EMAIL:''},windowsHide:true,timeout:90000});}catch(error){missingOwner=error;}assert.ok(missingOwner);assert.ok(missingOwner.stderr.includes('owner_bootstrap_required'));
 for(let pass=0;pass<2;pass++){let result;try{result=await run(process.execPath,['scripts/db-migrate.mjs'],{env,windowsHide:true,timeout:90000});}catch(error){const events=(error.stderr||'').split('\n').filter(line=>line.startsWith('{')&&line.includes('\"event\"'));assert.fail('Controlled migration failed: '+(events.join(' ')||error.code||'unknown failure'));}assert.ok(result.stdout.includes('database_migration_complete'));assert.ok(!result.stdout.includes(direct.password));}
 db=createDatabase(pooled.toString(),{schema});assert.equal(await db.administrator.count(),1);assert.equal(await db.membershipPlan.count(),3);
 const before=await db.administrator.findMany({select:{id:true,email:true,role:true,status:true,clerkUserId:true}});
 const ready=await fetch(origin+'/healthz');assert.equal(ready.status,200);assert.equal((await ready.json()).database,true);
 assert.ok(output.includes('api_started'));assert.ok(!output.includes('database_migration_complete'));assert.ok(!output.includes(env.STREAM_SERVICE_TOKEN));
 child.kill();await once(child,'exit');assert.deepEqual(await db.administrator.findMany({select:{id:true,email:true,role:true,status:true,clerkUserId:true}}),before);
});

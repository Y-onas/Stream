import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';

test('first deployment: actual API/Go configuration checks fail safely without network or migrations',{skip:process.env.RUN_DEPLOYMENT_TESTS!=='1',timeout:120000},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'hh-deploy-config-'));t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));return rm(directory,{recursive:true,force:true});});
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),privatePath=path.join(directory,'private.pem'),publicPath=path.join(directory,'public.pem');await writeFile(privatePath,keys.privateKey.export({type:'pkcs8',format:'pem'}));await writeFile(publicPath,keys.publicKey.export({type:'spki',format:'pem'}));
 const root=path.resolve('.'),go=path.join(root,'.tools/go/bin/go.exe'),binary=path.join(root,'.local/qa/deployment-stream-service.exe');await mkdir(path.dirname(binary),{recursive:true});
 const goEnv={...process.env,GOPATH:path.join(root,'.tools/gopath'),GOCACHE:path.join(root,'.tools/gocache')};
 execFileSync(existsSync(go)?go:'go',['build','-o',binary,'./cmd/stream-service'],{cwd:path.join(root,'services/stream-go'),env:goEnv,windowsHide:true,timeout:90000,stdio:['ignore','ignore','pipe']});
 const env={...process.env,NODE_ENV:'production',DATA_BASE_URL:'postgresql://fixture:fixture@db.invalid/hub?sslmode=verify-full',DATA_BASE_DIRECT_URL:'',PUBLIC_ORIGIN:'https://hub.example.test',ADMIN_ORIGIN:'https://hub.example.test',STREAM_ORIGIN:'http://stream-go:8080',STREAM_SERVICE_TOKEN:randomBytes(32).toString('hex'),API_GATEWAY_TOKEN:randomBytes(32).toString('hex'),CLERK_PUBLIC_KEY:'pk_live_fixture',CLERK_SECRET_KEY:'sk_live_fixture',EMAIL:'',PLAYBACK_PRIVATE_KEY_PATH:privatePath,PLAYBACK_PUBLIC_KEY_PATH:publicPath,PLAYBACK_PREVIOUS_KEYS_PATH:'',PLAYBACK_KEY_ID:'',TELEGRAM_API_ID:'12345',TELEGRAM_API_HASH:'a'.repeat(32),TELEGRAM_SOURCE:'Fixture channel',USER_NAME:'fixture_user'};
 let result=spawnSync(process.execPath,['scripts/start-production.mjs','--check-config'],{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).migrationsAutomatic,false);
 result=spawnSync(process.execPath,['scripts/start-production.mjs','--check-config'],{env:{...env,PUBLIC_ORIGIN:'http://not-secure.invalid'},encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,1);assert.ok(result.stderr.includes('PUBLIC_ORIGIN'));
 const args=['-env',path.join(directory,'absent.env'),'-check-config'];
 result=spawnSync(binary,args,{env,encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stdout+result.stderr);assert.ok(result.stdout.includes('stream_configuration_valid'));
 for(const name of ['TELEGRAM_API_ID','TELEGRAM_API_HASH','TELEGRAM_SOURCE','USER_NAME']){const child=spawnSync(binary,args,{env:{...env,[name]:''},encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(child.status,1,name);assert.ok((child.stdout+child.stderr).includes(name));assert.ok(!(child.stdout+child.stderr).includes(env.TELEGRAM_API_HASH));}
});

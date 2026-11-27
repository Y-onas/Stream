import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {isolatedDatabase} from './helpers/playback-database.mjs';
import {createDatabase} from '../services/api/src/database.mjs';
import {migrationDatabaseUrl} from '../services/api/src/config.mjs';
const run=promisify(execFile);

test('Module 5: pg_dump/pg_restore round-trip only a disposable application schema',{skip:process.env.RUN_BACKUP_TESTS!=='1',timeout:180000},async t=>{
 const db=await isolatedDatabase(t,'hh5_backup'),schema=db.appSchema;
 assert.match(schema,/^hh5_backup_[a-f0-9]{16}$/);
 const fixture=await db.video.create({data:{id:'disposable-backup-video',title:'Disposable backup fixture',filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1234,uploadedAt:new Date(),accessType:'FREE'}});
 const directory=await mkdtemp(path.join(tmpdir(),'hh5-backup-'));t.after(()=>rm(directory,{recursive:true,force:true}));const archive=path.join(directory,'fixture.dump');
 const url=new URL(migrationDatabaseUrl(process.env.DATA_BASE_URL,process.env.DATA_BASE_DIRECT_URL)),env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:url.searchParams.get('sslmode')||'require',PGCONNECT_TIMEOUT:'10'};
 const bin=process.env.POSTGRES_BIN||'';
 const tool=name=>bin?path.join(bin,name+(process.platform==='win32'?'.exe':'')):name;
 if(bin&&!existsSync(tool('pg_dump')))throw Error('Configure POSTGRES_BIN for a matching PostgreSQL client.');
 try{await run(tool('pg_dump'),['--format=custom','--no-owner','--no-acl','--schema='+schema,'--file='+archive],{env,windowsHide:true,timeout:90000});}
 catch(error){const reason=/version mismatch|server version/i.test(error.stderr||'')?'client/server version mismatch':/password authentication failed/i.test(error.stderr||'')?'authentication failed':/SSL|certificate/i.test(error.stderr||'')?'TLS configuration':'tool or database access';throw Error(`Disposable pg_dump failed (exit ${error.code}; ${reason}). Configure a matching POSTGRES_BIN. Credentials are not logged.`);}
 const list=await run(tool('pg_restore'),['--list',archive],{env,windowsHide:true,timeout:10000});
 assert.ok(list.stdout.includes(schema));assert.ok(!list.stdout.split('\n').some(line=>/^\d+;/.test(line)&&/\bpublic\b/.test(line)));
 // This schema was created above solely for this acceptance test. No --clean,
 // database reset, application-schema drop or unrelated restore is permitted.
 await db.$disconnect();const control=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000});await control.connect();
 try{await control.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await control.end();}
 try{await run(tool('pg_restore'),['--no-owner','--no-acl','--exit-on-error','--single-transaction','--dbname='+env.PGDATABASE,archive],{env,windowsHide:true,timeout:90000});}
 catch(error){throw Error(`Disposable pg_restore failed (exit ${error.code}). Credentials are not logged.`);}
 const restored=createDatabase(process.env.DATA_BASE_URL,{schema});try{const row=await restored.video.findUnique({where:{id:fixture.id}});assert.equal(row.publicId,fixture.publicId);assert.equal(row.accessType,'FREE');assert.equal(row.sizeBytes,1234n);}finally{await restored.$disconnect();}
});

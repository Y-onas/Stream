import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationDatabaseUrl} from '../services/api/src/config.mjs';
import {start} from '../services/api/src/server.mjs';
test('database configuration protects migration sessions and requires production visibility storage',()=>{
 const pooled='postgresql://test:p%40ss@ep-test-pooler.eu-central-1.aws.neon.tech/db?sslmode=verify-full&pgbouncer=true';
 const direct=new URL(migrationDatabaseUrl(pooled));
 assert.equal(direct.hostname,'ep-test.eu-central-1.aws.neon.tech');assert.equal(direct.password,'p%40ss');assert.equal(direct.searchParams.get('sslmode'),'verify-full');assert.equal(direct.searchParams.has('pgbouncer'),false);
 assert.equal(migrationDatabaseUrl('postgresql://test:pw@localhost:5432/db'),'postgresql://test:pw@localhost:5432/db');
 assert.equal(migrationDatabaseUrl(pooled,'postgresql://custom/direct'),'postgresql://custom/direct');
 const before={database:process.env.DATA_BASE_URL,mode:process.env.NODE_ENV};
 try{process.env.DATA_BASE_URL='';process.env.NODE_ENV='production';assert.throws(()=>start(),/DATA_BASE_URL is required/);}
 finally{for(const [key,value] of [['DATA_BASE_URL',before.database],['NODE_ENV',before.mode]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationConfig} from '../services/api/src/config.mjs';

test('USER_NAME is a support fallback only; dedicated support settings retain precedence',t=>{
 const keys=['USER_NAME','TELEGRAM_SUPPORT_USERNAME'],before=new Map(keys.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const [key,value] of before)if(value===undefined)delete process.env[key];else process.env[key]=value;});
 process.env.USER_NAME='support_human';process.env.TELEGRAM_SUPPORT_USERNAME='';
 assert.equal(applicationConfig().supportUsername,'support_human');
 assert.equal(applicationConfig().bootstrapName,'');
 process.env.TELEGRAM_SUPPORT_USERNAME='dedicated_support';
 assert.equal(applicationConfig().supportUsername,'dedicated_support');
 process.env.USER_NAME='';process.env.TELEGRAM_SUPPORT_USERNAME='';
 assert.equal(applicationConfig().supportUsername,'');
});

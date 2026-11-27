import test from 'node:test';
import assert from 'node:assert/strict';
import {startCatalogueSync} from '../services/api/src/catalogue-sync.mjs';
import {inspectDuration} from '../services/api/src/media-metadata.mjs';

async function wait(check){for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Inspection did not finish');}
async function fixture(t,inspect){
 const row={id:'duration-fixture',title:'Fixture',filename:'fixture.mp4',sizeBytes:1024n,uploadedAt:new Date(),available:true,durationSeconds:null,inspectionAttemptedAt:null};let cycles=0;
 const db={video:{
  async findMany(options){if(options.select)return [{...row}];return row.durationSeconds===null&&(!row.inspectionAttemptedAt||row.inspectionAttemptedAt<Date.now()-30*60000)?[{...row}]:[];},
  upsert:async()=>row,
  async update({data}){Object.assign(row,data);return row;},
  async updateMany({where,data}){if(+row.inspectionAttemptedAt===+where.inspectionAttemptedAt){Object.assign(row,data);return {count:1};}return {count:0};}
 },$transaction:async operations=>Promise.all(operations)};
 const sync=startCatalogueSync({db,streamOrigin:'http://fixture.invalid',streamToken:'fixture',interval:10,inspect,fetcher:async()=>{cycles++;return Response.json({items:[{...row,sizeBytes:1024}],sync:{initialComplete:false}});}});
 t.after(()=>sync.close());await sync.initial;
 return {row,sync,cycles:()=>cycles};
}

test('busy duration worker does not impose a thirty-minute inspection cooldown',async t=>{
 t.mock.method(console,'log',()=>{});let attempts=0;
 const f=await fixture(t,async()=>{if(++attempts===1)throw Object.assign(Error('Busy'),{code:'BACKGROUND_BUSY'});return 123;});
 await wait(()=>f.row.durationSeconds===123);assert.equal(attempts,2);assert.equal(f.row.durationSource,'ffmpeg');
});

test('actual failed duration inspections retain their cooldown',async t=>{
 t.mock.method(console,'log',()=>{});let attempts=0;
 const f=await fixture(t,async()=>{attempts++;throw Error('Unusable media');});
 await wait(()=>f.cycles()>=3);assert.equal(attempts,1);assert.ok(f.row.inspectionAttemptedAt instanceof Date);assert.equal(f.row.durationSeconds,null);
});

test('a busy metadata lease fails before duration inspection reads any media',async()=>{
 await assert.rejects(inspectDuration({id:'fixture'},{jobLease:async()=>{throw Object.assign(Error('Busy'),{code:'BACKGROUND_BUSY'});},fetcher:()=>assert.fail('No media read expected')}),error=>error.code==='BACKGROUND_BUSY');
});

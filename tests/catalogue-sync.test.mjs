import test from 'node:test';
import assert from 'node:assert/strict';
import {importCatalogue} from '../services/api/src/catalogue-sync.mjs';

const video=(id,extra={})=>({id,title:'Video',filename:'video.mp4',mimeType:'video/mp4',sizeBytes:1024,uploadedAt:'2026-11-02T00:00:00Z',...extra});
function database(initial=[]){
  const rows=new Map(initial.map(v=>[v.id,{available:true,...v}])),batches=[],availability=[];
  const db={video:{
    findMany:async()=>[...rows.values()],
    upsert:options=>()=>{const old=rows.get(options.where.id);rows.set(options.where.id,old?{...old,...options.update}:options.create);},
    updateMany:async options=>{availability.push(options);for(const row of rows.values())if(row.available&&!options.where.id.notIn.includes(row.id))Object.assign(row,options.data);},
  },$transaction:async operations=>{batches.push(operations.length);for(const operation of operations)operation();}};
  return {db,rows,batches,availability};
}

test('invalid records do not block valid imports or mark existing videos unavailable',async t=>{
  const {db,rows,batches,availability}=database([{id:'invalid-record',filename:'old.mp4',sizeBytes:1024n},{id:'missing-record',filename:'missing.mp4',sizeBytes:1024n}]);
  const logs=[];t.mock.method(console,'log',message=>logs.push(JSON.parse(message)));
  const invalid=[null,undefined,video(42),video('invalid/id'),video('invalid-record',{filename:null}),video('zero',{sizeBytes:0}),video('unsafe',{sizeBytes:Number.MAX_SAFE_INTEGER+1}),video('bad-date',{uploadedAt:'not a date'})];
  const now=new Date('2026-11-02T01:00:00Z');
  assert.equal(await importCatalogue(db,{items:[video('channel-42-1'),...invalid,video('group-42-2')],sync:{initialComplete:true}},now),2);
  assert.deepEqual(batches,[2]);assert.equal(rows.get('channel-42-1').available,true);assert.equal(rows.get('group-42-2').available,true);
  assert.equal(rows.get('channel-42-1').sizeBytes,1024n);assert.equal(rows.get('channel-42-1').lastSyncedAt,now);
  assert.equal(rows.get('invalid-record').available,true);assert.equal(rows.get('invalid-record').filename,'old.mp4');assert.equal(rows.get('missing-record').available,true);
  assert.deepEqual(availability,[]);
  assert.deepEqual(logs,[{event:'catalogue_items_skipped',count:invalid.length}]);
  // A subsequent clean snapshot can confirm which old records really disappeared.
  assert.equal(await importCatalogue(db,{items:[video('channel-42-1'),video('group-42-2')],sync:{initialComplete:true}},now),2);
  assert.deepEqual(availability[0].where.id.notIn,['channel-42-1','group-42-2']);
  assert.equal(rows.get('invalid-record').available,false);assert.equal(rows.get('missing-record').available,false);
  assert.equal(rows.get('channel-42-1').available,true);assert.equal(rows.get('group-42-2').available,true);
});

test('partial scans skip invalid records without changing existing availability',async t=>{
  const {db,rows,availability}=database([{id:'existing',filename:'old.mp4',sizeBytes:1024n}]);t.mock.method(console,'log',()=>{});
  assert.equal(await importCatalogue(db,{items:[null,video('new-video')],sync:{initialComplete:false}}),1);
  assert.equal(rows.get('existing').available,true);assert.equal(rows.get('new-video').available,true);assert.deepEqual(availability,[]);
});

test('completed scans with only rejected items preserve existing availability',async t=>{
  const {db,rows,batches,availability}=database([{id:'existing',filename:'old.mp4',sizeBytes:1024n}]);t.mock.method(console,'log',()=>{});
  assert.equal(await importCatalogue(db,{items:[video('existing',{sizeBytes:-1}),null],sync:{initialComplete:true}}),0);
  assert.deepEqual(batches,[]);assert.deepEqual(availability,[]);assert.equal(rows.get('existing').available,true);
});

test('genuinely empty completed snapshots still mark missing videos unavailable',async()=>{
  const {db,rows,availability}=database([{id:'existing',filename:'old.mp4',sizeBytes:1024n}]);
  assert.equal(await importCatalogue(db,{items:[],sync:{initialComplete:true}}),0);
  assert.deepEqual(availability[0].where.id.notIn,[]);assert.equal(rows.get('existing').available,false);
});

test('valid imports retain batching and only report imported records',async t=>{
  const {db,batches,rows}=database();t.mock.method(console,'log',()=>assert.fail('Valid metadata must not emit a skip warning'));
  const items=Array.from({length:101},(_,i)=>video(`video-${i}`));
  assert.equal(await importCatalogue(db,{items}),101);assert.deepEqual(batches,[50,50,1]);assert.equal(rows.size,101);
});

test('invalid catalogue envelopes fail before database reads or availability changes',async()=>{
  const db={video:{findMany:async()=>assert.fail('Invalid catalogue must not access the database')}};
  for(const catalogue of [null,undefined,{}, {items:null},{items:{}}])await assert.rejects(importCatalogue(db,catalogue),/Invalid catalogue/);
});

test('database failures still abort the import before marking records unavailable',async()=>{
  const {db,availability}=database();const error=new Error('Database unavailable');db.$transaction=async()=>{throw error;};
  await assert.rejects(importCatalogue(db,{items:[video('valid')],sync:{initialComplete:true}}),received=>received===error);
  assert.deepEqual(availability,[]);
});

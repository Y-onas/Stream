import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../services/api/src/application.mjs';
import {HttpError} from '../services/api/src/domain.mjs';

const uuid='01234567-89ab-4cde-8f01-23456789abcd';
const catalogueURL=ids=>new URL('http://public.test/api/videos?'+new URLSearchParams({ids}));
const application=db=>createApplication({db,config:{supportUsername:'',timezone:'Africa/Nairobi'},adminAuth:async()=>null});

test('invalid catalogue ID lists return 400 before reaching the UUID database column',async()=>{
 const unexpected=()=>assert.fail('Invalid IDs must not reach a catalogue query');
 const app=application({video:{findMany:unexpected,count:unexpected}});
 for(const ids of ['channel-1-2','not-a-uuid','',`${uuid},`,`${uuid},channel-1-2`,Array(101).fill(uuid).join(',')]){
  await assert.rejects(app.catalogue(catalogueURL(ids)),error=>error instanceof HttpError&&error.status===400&&error.message==='Invalid video IDs.');
 }
});

test('catalogue accepts up to 100 UUIDs and filters by publicId',async()=>{
 const ids=Array(100).fill(uuid.toUpperCase());let queries=0;
 const check=({where})=>{queries++;assert.deepEqual(where.publicId,{in:ids});assert.equal(where.id,undefined);};
 const app=application({video:{findMany:async args=>{check(args);return [];},count:async args=>{check(args);return 0;}}});
 assert.deepEqual((await app.catalogue(catalogueURL(ids.join(',')))).items,[]);
 assert.equal(queries,2);
});

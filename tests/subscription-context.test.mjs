import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../services/api/src/application.mjs';

const videoId='01234567-89ab-4cde-8f01-23456789abcd',user={id:'test-user',username:'TestUser'};
const plan={id:'monthly',name:'Monthly',durationMonths:1,priceMinor:99000,currency:'ETB'};
function fixture({available=true,existing=null,activePlan=true}={}){
 const lookups=[];
 const db={video:{findFirst:async({where})=>{lookups.push(where);return available?{id:'private-source-id'}:null;}},
  subscriptionRequest:{findFirst:async()=>existing,create:async({data})=>data,update:async({data})=>({...existing,...data})},
  membershipPlan:{findFirst:async()=>activePlan?plan:null}};
 return {app:createApplication({db,config:{timezone:'Africa/Nairobi',supportUsername:''},adminAuth:async()=>null}),lookups};
}

test('missing or malformed optional video context does not block a server-priced request',async()=>{
 for(const context of [undefined,null,'','channel-1-2','-'.repeat(36),{},[videoId]]){
  const {app,lookups}=fixture();const request=await app.newRequest(user,'monthly',context);
  assert.equal(request.intendedVideoPublicId,null);assert.equal(request.amountMinorSnapshot,99000);assert.equal(lookups.length,0);
 }
});

test('unavailable video context is dropped; available video context is preserved',async()=>{
 for(const available of [false,true]){
  const {app,lookups}=fixture({available});const request=await app.newRequest(user,'monthly',videoId);
  assert.equal(request.intendedVideoPublicId,available?videoId:null);
  assert.deepEqual(lookups,[{publicId:videoId,published:true,available:true,adminUnavailable:false}]);
 }
});

test('invalid new context does not overwrite a pending request; valid context can update it',async()=>{
 const existing={id:'pending-request',intendedVideoPublicId:videoId,version:0};
 assert.equal(await fixture({existing}).app.newRequest(user,'monthly','invalid'),existing);
 const replacement='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const updated=await fixture({existing}).app.newRequest(user,'monthly',replacement);
 assert.equal(updated.intendedVideoPublicId,replacement);assert.deepEqual(updated.version,{increment:1});
});

test('ignoring optional video context does not bypass package validation',async()=>{
 const {app}=fixture({activePlan:false});
 await assert.rejects(app.newRequest(user,'missing','invalid'),error=>error.status===400&&error.message==='This package is not available.');
 await assert.rejects(app.newRequest(user,null,'invalid'),error=>error.status===400&&error.message==='Select a membership package.');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeartbeatQueue} from '../apps/web/src/services/heartbeat-queue.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const report=(playedSeconds,position=playedSeconds)=>({position,playedSeconds,playing:playedSeconds>0,seeking:false,state:'PLAYING'});

test('unaccepted heartbeat seconds and sequence survive a temporary failure',async()=>{
 const queue=createHeartbeatQueue(),sent=[],errors=[];
 queue.configure({send:async data=>{sent.push({...data});if(sent.length===1)throw Error('Temporary outage');return {accepted:true};},failed:error=>errors.push(error)});
 await queue.report(report(30));assert.equal(errors.length,1);assert.equal(sent.length,1,'failure must not hot-loop');
 await queue.report(report(10,40));await tick();
 assert.deepEqual(sent.map(r=>[r.sequence,r.playedSeconds,r.position]),[[1,30,30],[1,30,30],[2,10,40]]);
});

test('a lost acknowledgement retries the same immutable report without double counting',async()=>{
 const queue=createHeartbeatQueue(4),sent=[];let serverSequence=4,watched=0;
 queue.configure({send:async data=>{
  sent.push({...data});const accepted=data.sequence>serverSequence;
  if(accepted){serverSequence=data.sequence;watched+=data.playedSeconds;}
  if(sent.length===1)throw Error('Response lost after commit');
  return {accepted};
 }});
 await queue.report(report(30));await queue.report(report(10,40));await tick();
 assert.deepEqual(sent.map(r=>r.sequence),[5,5,6]);assert.equal(watched,40);
 assert.deepEqual(sent[0],sent[1]);
});

test('later samples coalesce within one bounded report while an unacknowledged report is retained',async()=>{
 const queue=createHeartbeatQueue(),sent=[];let release;
 const held=new Promise(resolve=>{release=resolve;});
 queue.configure({send:async data=>{sent.push({...data});if(sent.length===1){await held;throw Error('Unavailable');}return {accepted:true};}});
 const first=queue.report(report(30));await tick();
 for(let n=1;n<=100;n++)void queue.report(report(1,30+n));
 assert.equal(sent.length,1);release();await first;assert.equal(sent.length,1);
 await queue.report(report(0,150));await tick();
 assert.deepEqual(sent.map(r=>[r.sequence,r.playedSeconds,r.position]),[[1,30,30],[1,30,30],[2,45,150]]);
});

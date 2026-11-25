import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackLifecycle} from '../apps/web/src/services/playback-lifecycle.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('leaving a video terminates its session exactly once',async()=>{
 const calls=[],page=createPlaybackLifecycle({authorize:async()=>({id:'first'}),terminate:async session=>calls.push(session.id)});
 await page.ready;const closing=page.close();assert.deepEqual(calls,['first'],'pagehide must initiate keepalive immediately');assert.equal(await closing,true);await page.close();assert.deepEqual(calls,['first']);
});

test('the next video waits for the previous session to finish closing',async()=>{
 const released=deferred(),calls=[];
 const first=createPlaybackLifecycle({authorize:async()=>({id:'first'}),terminate:()=>{calls.push('closing');return released.promise;}});
 await first.ready;const closing=first.close();
 const second=createPlaybackLifecycle({authorize:async()=>{calls.push('second');return {id:'second'};},terminate:async()=>{}});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['closing']);
 released.resolve();await closing;await second.ready;assert.deepEqual(calls,['closing','second']);await second.close();
});

test('a late authorization is terminated after navigating away',async()=>{
 const response=deferred(),started=deferred(),calls=[];
 const first=createPlaybackLifecycle({authorize:()=>{started.resolve();return response.promise;},terminate:async session=>calls.push(session.id)});
 await started.promise;const closing=first.close();
 const second=createPlaybackLifecycle({authorize:async()=>{calls.push('next');return {id:'next'};},terminate:async()=>{}});
 response.resolve({id:'late'});await closing;await second.ready;assert.deepEqual(calls,['late','next']);await second.close();
});

test('a page closed before authorization begins never creates a session',async()=>{
 let calls=0;const page=createPlaybackLifecycle({authorize:async()=>{calls++;return {id:'unused'};},terminate:async()=>{calls++;}});
 await page.close();assert.equal(await page.ready,null);assert.equal(calls,0);
});

test('failed authorization or release does not wedge later video pages',async()=>{
 const failed=createPlaybackLifecycle({authorize:async()=>{throw Error('offline');},terminate:async()=>{throw Error('unused');}});
 await assert.rejects(failed.ready);assert.equal(await failed.close(),false);
 const page=createPlaybackLifecycle({authorize:async()=>({id:'second'}),terminate:async()=>{throw Error('offline');}});
 assert.equal((await page.ready).id,'second');assert.equal(await page.close(),false);
 const next=createPlaybackLifecycle({authorize:async()=>({id:'third'}),terminate:async()=>{}});
 assert.equal((await next.ready).id,'third');assert.equal(await next.close(),true);
});

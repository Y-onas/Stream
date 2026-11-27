import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../services/api/src/operations.mjs';

test('container CPU timestamps are paired with their read, independently of slow probes',async t=>{
 let monotonic=0,wall=10000,cpu=1000000,release;
 t.mock.method(Date,'now',()=>wall);
 const db={playbackSession:{count:async()=>0},upstreamLease:{count:async()=>0},$queryRaw:async()=>[{count:0}],platformSettings:{findUnique:async()=>({sessionUpstreamLimit:2})}};
 const operations=createOperations({db,config:{sessionUpstreamLimit:1},now:()=>new Date(wall),clock:()=>monotonic,read:async path=>path.endsWith('cpu.stat')?`usage_usec ${cpu}`:null});
 t.after(()=>operations.close());
 operations.setGoProbe(()=>new Promise(resolve=>{release=resolve;}));
 const first=operations.get();await new Promise(resolve=>setImmediate(resolve));monotonic=3000;release(null);
 assert.equal((await first).api.containerCPU,null);
 wall+=11000;monotonic=13000;cpu=14000000;operations.setGoProbe(async()=>null);
 const second=await operations.get();assert.equal(second.api.containerCPU,1);assert.equal(second.policy.sessionUpstreamLimit,1);
});

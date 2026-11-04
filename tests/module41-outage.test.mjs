import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAPI} from '../services/api/src/server.mjs';
import {createApplication} from '../services/api/src/application.mjs';
test('database outage denies public data and media when visibility policy cannot be checked',async t=>{
  const fail=async()=>{throw Error('Database unavailable; private connection information');},db={membershipPlan:{findMany:fail,count:fail},video:{findMany:fail,count:fail},userSession:{findUnique:fail},$queryRaw:fail,$disconnect:async()=>{}};
  const app=createApplication({db,config:{supportUsername:'',currency:'ETB',adminOrigin:'http://admin.test',timezone:'Africa/Nairobi',adminIds:[]}});
  const video={id:'channel-42-1',filename:'real.mp4',title:'Existing video',sizeBytes:1000};
  const api=http.createServer(createAPI({streamOrigin:'http://stream-go',streamToken:'s'.repeat(40),publicOrigin:'http://public.test',application:app,fetcher:async url=>url.pathname==='/internal/catalogue'?new Response(JSON.stringify({items:[video]})):url.pathname==='/readyz'?new Response('{}'):new Response(Buffer.alloc(4),{status:206,headers:{'Content-Type':'video/mp4','Content-Length':'4','Content-Range':'bytes 0-3/1000'}})}));
  api.listen(0,'127.0.0.1');await once(api,'listening');t.after(()=>{api.closeAllConnections();api.close();});const root=`http://127.0.0.1:${api.address().port}`;
  assert.equal((await fetch(root+'/healthz')).status,503);const plans=await fetch(root+'/api/plans');assert.equal(plans.status,503);assert.ok(!(await plans.text()).includes('private connection'));
  const latest=await fetch(root+'/api/videos');assert.equal(latest.status,503);
  assert.equal((await fetch(root+'/api/videos?sort=most-viewed')).status,503);assert.equal((await fetch(root+'/api/playback/01234567-1234-4234-8234-012345678901/stream',{headers:{Range:'bytes=0-3'}})).status,401);
});

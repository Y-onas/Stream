import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './helpers/playback-database.mjs';
import {createApplication} from '../services/api/src/application.mjs';
import {reportSource} from '../services/api/src/source-status.mjs';

test('Module 5: bounded analytics facade and temporary/permanent source status',{skip:process.env.RUN_DB_TESTS!=='1',timeout:90000},async t=>{
 const db=await isolatedDatabase(t,'hh5_ops');
 await db.platformSettings.create({data:{id:'platform',playbackLimit:1,upstreamLimit:1,sessionUpstreamLimit:1}});
 const admin={id:'isolated-owner',role:'OWNER'},app=createApplication({db,config:{timezone:'Africa/Nairobi',supportUsername:''},adminAuth:async()=>admin});
 t.after(()=>app.close());let status,data;
 const response={writeHead(value){status=value;},end(value){data=JSON.parse(value);}};
 await app.handle({method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}},response,new URL('http://admin.test/api/admin/analytics?preset=today'));
 assert.equal(status,200);assert.equal(data.views.total,0);
 const operations=await app.operations.get();assert.equal(operations.policy.globalPlaybackLimit,null);assert.equal(operations.policy.globalUpstreamLimit,null);assert.equal(operations.policy.vipSessionsPerAccount,2);assert.equal(operations.policy.sessionUpstreamLimit,1);assert.ok(!operations.warnings.some(w=>w.includes('capacity is full')));
 const video=await db.video.create({data:{id:'isolated-source',title:'Fixture',filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1000,uploadedAt:new Date()}});
 const at=new Date();await reportSource(db,{videoId:video.publicId,status:'TEMPORARY_UNAVAILABLE'},at);
 let current=await db.video.findUnique({where:{id:video.id}});assert.equal(current.available,true);assert.equal(current.accessType,'VIP');assert.equal(current.sourceStatus,'TEMPORARY_UNAVAILABLE');assert.equal(+current.sourceRetryAt,+at+30000);
 await reportSource(db,{videoId:video.publicId,status:'PERMANENT_UNAVAILABLE'},at);current=await db.video.findUnique({where:{id:video.id}});assert.equal(current.available,false);assert.equal(await db.video.count(),1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeekQueue,createVideoTransport} from '../apps/web/src/services/video-transport.mjs';
function scheduler(){let next=0;const work=new Map();return {schedule:(fn,delay)=>{const id=++next;work.set(id,{fn,delay});return id;},cancel:id=>work.delete(id),run(){const [id,job]=work.entries().next().value||[];if(!job)return;work.delete(id);job.fn();return job.delay;},size:()=>work.size};}
test('rapid forward/back taps become one clamped final seek',()=>{
 const time=scheduler(),targets=[];let position=5;
 const queue=createSeekQueue({position:()=>position,duration:()=>120,apply:value=>{targets.push(value);position=value;},...time});
 for(let n=0;n<8;n++)queue.by(10);queue.by(-10);assert.equal(time.size(),1);assert.deepEqual(targets,[]);time.run();assert.deepEqual(targets,[75]);
 for(let n=0;n<20;n++)queue.by(10);time.run();assert.equal(targets.at(-1),119.95);
 queue.by(-1000);time.run();assert.equal(targets.at(-1),0);queue.by(10);queue.clear();assert.equal(time.size(),0);
});
class Media extends EventTarget{currentTime=45;duration=120;readyState=4;paused=false;seeking=false;error={code:2};src='/authorized';loads=0;plays=0;removeAttribute(){this.src='';}load(){this.loads++;this.readyState=0;this.currentTime=0;}play(){this.plays++;this.paused=false;return Promise.resolve();}}
test('timeline changes and skip taps share one final seek and ignore invalid targets',()=>{
 const time=scheduler(),targets=[];
 const queue=createSeekQueue({position:()=>5,duration:()=>120,apply:value=>targets.push(value),...time});
 queue.to(70);queue.by(10);queue.by(-10);queue.to(NaN);assert.equal(queue.target(),70);assert.equal(time.size(),1);time.run();assert.deepEqual(targets,[70]);
 queue.to(900);time.run();assert.equal(targets.at(-1),119.95);queue.to(-1);time.run();assert.equal(targets.at(-1),0);
 queue.to(40);queue.clear();assert.equal(time.size(),0);assert.equal(queue.target(),null);
});
function fixture(fetcher,extra={}){const element=new Media(),waiting=[],errors=[],time=scheduler();const transport=createVideoTransport({element,source:'/authorized',duration:120,fetcher,onWaiting:value=>waiting.push(value),onError:value=>errors.push(value),...time,...extra});return {element,waiting,errors,time,transport};}
test('resume starts loading before metadata and seeks once the duration arrives',async()=>{
 const f=fixture(()=>{throw Error('Resume must not authorize or probe a new stream');});
 f.element.readyState=0;f.element.duration=NaN;f.element.currentTime=0;f.element.paused=true;
 await f.transport.startAt(80);assert.equal(f.element.plays,1);assert.equal(f.element.currentTime,0);assert.equal(f.element.loads,0);
 f.element.duration=120;f.element.readyState=1;f.transport.metadata();assert.equal(f.element.currentTime,80);assert.equal(f.element.src,'/authorized');
 f.transport.seekBy(10);assert.equal(f.time.size(),1);await f.transport.startAt(0);assert.equal(f.time.size(),0);assert.equal(f.element.currentTime,0);
 f.transport.close();f.transport.startAt(30);assert.equal(f.element.plays,2);
});
test('optional Resume seeks within the playing element without reloading or changing preferences',async()=>{
 const f=fixture(()=>{throw Error('Resume must not probe another source');});
 f.element.playbackRate=1.5;f.element.muted=true;
 await f.transport.startAt(0);assert.equal(f.element.currentTime,0);
 // Preparing saved progress while the beginning plays is just data, not a seek.
 const progress={position:80,completed:false};assert.equal(f.element.currentTime,0);
 await f.transport.startAt(progress.position);
 assert.equal(f.element.currentTime,80);assert.equal(f.element.src,'/authorized');assert.equal(f.element.loads,0);
 assert.equal(f.element.playbackRate,1.5);assert.equal(f.element.muted,true);assert.equal(f.element.paused,false);f.transport.close();
});
test('a network failure before the first frame retains Play intent but respects a real pause',async()=>{
 for(const userPaused of [false,true]){
  const element=new Media();element.paused=true;element.readyState=0;element.error=null;
  const time=scheduler(),transport=createVideoTransport({element,source:'/authorized',duration:120,fetcher:async()=>new Response(null,{status:503}),onWaiting(){},onError(){},...time});
  element.paused=false;element.dispatchEvent(new Event('play'));
  if(userPaused){element.paused=true;element.dispatchEvent(new Event('pause'));}
  element.error={code:2};await transport.error();time.run();element.readyState=1;transport.metadata();transport.canPlay();
  assert.equal(element.plays,userPaused?0:1);transport.close();
 }
});
test('temporary busy responses buffer, reload the same URL and restore time/play intent',async()=>{
 const f=fixture(async()=>new Response(null,{status:503,headers:{'Retry-After':'2'}}));
 await f.transport.error();assert.equal(f.waiting.at(-1),true);assert.equal(f.errors.at(-1),'');assert.equal(f.element.src,'');assert.equal(f.time.run(),2000);
 assert.equal(f.element.src,'/authorized');f.element.duration=120;f.element.readyState=1;f.transport.metadata();assert.equal(f.element.currentTime,45);f.transport.canPlay();assert.equal(f.element.plays,1);assert.equal(f.waiting.at(-1),false);f.transport.close();
});
test('the latest seek target survives an interrupted request without a new session',async()=>{
 const f=fixture(async()=>new Response(null,{status:503}));for(let n=0;n<3;n++)f.transport.seekBy(10);
 await f.transport.error();f.time.run();f.time.run();f.element.duration=120;f.transport.metadata();assert.equal(f.element.currentTime,75);f.transport.close();
});
test('denied authorization and missing media do not retry',async()=>{
 for(const status of [401,403,404,410]){const f=fixture(async()=>new Response(null,{status}),{revalidate:async()=>false});await f.transport.error();assert.equal(f.time.size(),0);assert.ok(f.errors.at(-1));f.transport.close();}
});
test('a renewed authorization resumes; genuine codec failures and persistent outages stay bounded',async()=>{
 const renewed=fixture(async()=>new Response(null,{status:401}),{revalidate:async()=>true});await renewed.transport.error();assert.equal(renewed.time.size(),1);renewed.transport.close();assert.equal(renewed.time.size(),0);
 const failed=fixture(async()=>new Response(null,{status:503}));for(let n=0;n<7;n++){failed.element.error={code:2};await failed.transport.error();failed.time.run();}assert.ok(failed.errors.at(-1).includes('could not recover'));assert.equal(failed.time.size(),0);failed.transport.close();
 const codec=fixture(async()=>new Response(null,{status:200}));codec.element.error={code:4};await codec.transport.error();codec.time.run();await codec.transport.error();assert.ok(codec.errors.at(-1).includes('codec'));assert.equal(codec.time.size(),0);codec.transport.close();
});
test('navigation cancels a pending recovery and never resurrects the old player',async()=>{
 let complete;const f=fixture(()=>new Promise(resolve=>{complete=resolve;}));const pending=f.transport.error();f.transport.close();complete(new Response(null,{status:503}));await pending;assert.equal(f.time.size(),0);assert.equal(f.element.src,'');
});

test('Retry-After cannot extend recovery beyond the deadline or reload after it',async()=>{
 for(const after of ['3600','Fri, 27 Nov 2026 13:00:00 GMT']){
  let clock=Date.parse('2026-11-27T12:00:00Z');
  const f=fixture(async()=>new Response(null,{status:503,headers:{'Retry-After':after}}),{now:()=>clock});
  await f.transport.error();const before=f.element.loads;clock+=45000;
  assert.equal(f.time.run(),45000);assert.equal(f.element.loads,before);assert.equal(f.element.src,'');
  assert.equal(f.waiting.at(-1),false);assert.match(f.errors.at(-1),/could not recover/);f.transport.close();
 }
});

test('a retry delay within the remaining budget reloads, including a clock starting at zero',async()=>{
 let clock=0;const f=fixture(async()=>new Response(null,{status:503,headers:{'Retry-After':'2'}}),{now:()=>clock});
 await f.transport.error();clock=2000;assert.equal(f.time.run(),2000);assert.equal(f.element.src,'/authorized');
 clock=44900;await f.transport.error();clock=45000;assert.equal(f.time.run(),100);assert.match(f.errors.at(-1),/could not recover/);f.transport.close();
});

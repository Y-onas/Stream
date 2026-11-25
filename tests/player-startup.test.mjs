import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackStarter,startupPosition,createResumeWindow} from '../apps/web/src/services/player-startup.mjs';

test('startup calls Play immediately after a source exists, without waiting for metadata',async()=>{
 const start=createPlaybackStarter(),element={readyState:0,paused:true,muted:false};let plays=0;
 await start(null,undefined,()=>{throw Error('no authorized source');});
 const pending=start(element,'/authorized',()=>{plays++;element.paused=false;return Promise.resolve();});
 assert.equal(plays,1);assert.equal(element.paused,false);assert.equal(element.muted,false);await pending;
});
test('rerenders and effect replays reuse the attempt and never undo a manual pause',async()=>{
 const start=createPlaybackStarter(),element={paused:true};let plays=0;
 const play=()=>{plays++;element.paused=false;return Promise.resolve();};
 const first=start(element,'/authorized',play);assert.equal(start(element,'/authorized',play),first);await first;
 element.paused=true;await start(element,'/authorized',play);assert.equal(plays,1);assert.equal(element.paused,true);
 await start({},'/authorized',play);await start(element,'/new-authorized-source',play);assert.equal(plays,3);
});
test('browser policy denial is reported without silent muting or repeated automatic attempts',async()=>{
 const start=createPlaybackStarter(),element={muted:false};let plays=0;
 const play=()=>{plays++;throw new DOMException('A user gesture is required.','NotAllowedError');};
 await assert.rejects(start(element,'/authorized',play),{name:'NotAllowedError'});
 await assert.rejects(start(element,'/authorized',play),{name:'NotAllowedError'});
 assert.equal(plays,1);assert.equal(element.muted,false);
});
test('resume uses the authorized position or actual unfinished progress and restarts completed media',()=>{
 assert.equal(startupPosition(),0);
 assert.equal(startupPosition({local:{position:19,completed:false}}),19);
 assert.equal(startupPosition({local:{position:19},account:{position:40,completed:false}}),40);
 assert.equal(startupPosition({local:{position:19},authorized:50}),50);
 assert.equal(startupPosition({local:{position:19},account:{position:100,completed:true}}),0);
 for(const position of [NaN,Infinity,-3,'19'])assert.equal(startupPosition({local:{position}}),0);
});
test('Resume expires 20 seconds after the first playing event and repeated buffering never extends it',()=>{
 const jobs=[];let expired=0;
 const window=createResumeWindow(()=>expired++,{schedule:(callback,delay)=>{jobs.push({callback,delay});return 1;},cancel(){}});
 assert.equal(jobs.length,0,'initial authorization/loading must not consume the window');
 window.start();window.start();assert.equal(jobs.length,1);assert.equal(jobs[0].delay,20000);
 jobs[0].callback();assert.equal(expired,1);window.start();assert.equal(jobs.length,1);
});
test('leaving a video cancels the suggestion timer and prevents stale state changes',()=>{
 let callback,expired=0,canceled;
 const window=createResumeWindow(()=>expired++,{schedule:fn=>{callback=fn;return 42;},cancel:id=>{canceled=id;}});
 window.start();window.close();callback();window.start();assert.equal(expired,0);assert.equal(canceled,42);
});

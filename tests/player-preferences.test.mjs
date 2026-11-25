import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYBACK_RATES,setPlaybackSpeed,setSoundEnabled,originalQuality,playerTime} from '../apps/web/src/services/player-preferences.mjs';

test('supported speeds change the playing media without changing sound, position or source',()=>{
 const media={src:'/authorized',currentTime:43,volume:.6,muted:false};
 assert.deepEqual(PLAYBACK_RATES,[.5,.75,1,1.25,1.5,2]);
 for(const rate of PLAYBACK_RATES){assert.equal(setPlaybackSpeed(media,rate),true);assert.equal(media.playbackRate,rate);assert.equal(media.defaultPlaybackRate,rate);}
 assert.equal(setPlaybackSpeed(media,3),false);assert.equal(media.playbackRate,2);
 assert.deepEqual({src:media.src,time:media.currentTime,volume:media.volume,muted:media.muted},{src:'/authorized',time:43,volume:.6,muted:false});
});
test('sound toggle is independent of speed and preserves the chosen volume',()=>{
 const media={src:'/authorized',currentTime:43,volume:.6,muted:false,playbackRate:1.5};
 setSoundEnabled(media,false);assert.equal(media.muted,true);assert.equal(media.volume,.6);
 setSoundEnabled(media,true);assert.equal(media.muted,false);assert.equal(media.volume,.6);
 media.volume=0;setSoundEnabled(media,true,.4);assert.equal(media.volume,.4);assert.equal(media.muted,false);
 media.volume=0;setSoundEnabled(media,true);assert.equal(media.volume,1);
 assert.equal(media.playbackRate,1.5);assert.equal(media.currentTime,43);assert.equal(media.src,'/authorized');
});
test('attaching controls at the existing speed does not rewrite media settings',()=>{
 let writes=0;
 const media={get playbackRate(){return 1;},set playbackRate(value){writes++;},get defaultPlaybackRate(){return 1;},set defaultPlaybackRate(value){writes++;}};
 assert.equal(setPlaybackSpeed(media,1),true);assert.equal(writes,0);
});
test('quality describes only the actual decoded original, including nonstandard resolutions',()=>{
 assert.deepEqual(originalQuality({videoHeight:1080}),{id:'original',label:'1080p · Original'});
 assert.equal(originalQuality({videoHeight:804}).label,'804p · Original');
 for(const videoHeight of [0,undefined,NaN])assert.equal(originalQuality({videoHeight}).label,'Original stream');
});
test('player clock handles unknown duration, minutes and hours',()=>{
 assert.equal(playerTime(Infinity),'0:00');assert.equal(playerTime(-1),'0:00');assert.equal(playerTime(61.9),'1:01');assert.equal(playerTime(3661),'1:01:01');
});

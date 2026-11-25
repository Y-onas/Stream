export const PLAYBACK_RATES=Object.freeze([.5,.75,1,1.25,1.5,2]);
export function setPlaybackSpeed(media,rate){
 if(!PLAYBACK_RATES.includes(rate))return false;
 if(media.defaultPlaybackRate!==rate)media.defaultPlaybackRate=rate;
 if(media.playbackRate!==rate)media.playbackRate=rate;
 return true;
}
export function setSoundEnabled(media,enabled,lastVolume=1){
 if(enabled&&media.volume===0)media.volume=Number.isFinite(lastVolume)&&lastVolume>0?Math.min(1,lastVolume):1;
 media.muted=!enabled;
}
// A resolution describes the actual decoded track, never a transcoding promise.
export function originalQuality(media){
 const height=media?.videoHeight;
 return {id:'original',label:Number.isInteger(height)&&height>0?`${height}p · Original`:'Original stream'};
}
export function playerTime(value){
 if(!Number.isFinite(value)||value<0)return '0:00';
 const seconds=Math.floor(value),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=String(seconds%60).padStart(2,'0');
 return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;
}

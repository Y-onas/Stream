import {spawn} from 'node:child_process';
import {openRangeSource,readVideoRange} from './thumbnails.mjs';
export async function inspectDuration(video,{streamOrigin,streamToken,ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg',fetcher=fetch,signal=new AbortController().signal}={}){
  const controller=new AbortController(),stop=()=>controller.abort();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  const timer=setTimeout(stop,90000),identity={};let source;
  try{
    source=await openRangeSource(video,{signal:controller.signal,maxBytes:16*1024*1024,maxRequests:48,readRange:(start,end,signal)=>readVideoRange({video,streamOrigin,streamToken,fetcher,start,end,signal,identity})});
    return await new Promise((resolve,reject)=>{
      const child=spawn(ffmpegPath,['-hide_banner','-loglevel','info','-nostdin','-protocol_whitelist','http,tcp','-rw_timeout','22000000','-seekable','1','-multiple_requests','1','-probesize','2097152','-analyzeduration','3000000','-threads','1','-i',source.url,'-map','0:V:0','-frames:v','0','-an','-sn','-dn','-f','null','-'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
      let output='',duration=null,settled=false;
      const finish=()=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',kill);child.kill('SIGKILL');if(duration&&duration>0&&duration<=7*86400)resolve(duration);else reject(Error('Duration could not be measured'));};
      const kill=()=>{child.kill('SIGKILL');finish();};controller.signal.addEventListener('abort',kill,{once:true});
      child.stderr.on('data',chunk=>{output=(output+chunk.toString()).slice(-32768);const match=/^  Duration: (\d+):(\d+):(\d+(?:\.\d+)?), start:/m.exec(output);if(match&&/Stream #0:.*Video:/.test(output)){duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);finish();}});
      child.once('error',finish);child.once('close',finish);if(controller.signal.aborted)kill();
    });
  }finally{clearTimeout(timer);controller.abort();source?.close();signal.removeEventListener('abort',stop);}
}

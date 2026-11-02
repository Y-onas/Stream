import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openRangeSource,extractFrame} from '../services/api/src/thumbnails.mjs';

// Opt-in decoder acceptance check. These synthetic clips are isolated test
// fixtures only; the application always extracts from the real Telegram video.
test('FFmpeg extracts nonblank frames from ranged MP4/MKV and rejects all-black clips',{skip:process.env.RUN_FFMPEG_TESTS!=='1',timeout:120000},async t=>{
  const ffmpeg=process.env.FFMPEG_PATH||path.resolve('.tools/ffmpeg/bin/ffmpeg.exe');
  const directory=await mkdtemp(path.join(tmpdir(),'hub-frame-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const extension of ['mp4','mkv']){
    const filename=path.join(directory,`test.${extension}`);
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12:d=10','-vf',"drawbox=color=black:t=fill:enable='lt(t,3)'",'-c:v','libx264','-pix_fmt',extension==='mkv'?'yuv420p10le':'yuv420p','-preset','ultrafast','-y',filename],{windowsHide:true,timeout:20000});
    const data=await readFile(filename),abort=new AbortController();
    const source=await openRangeSource({sizeBytes:data.length,mimeType:extension==='mp4'?'video/mp4':'video/x-matroska'},{signal:abort.signal,readRange:async(start,end)=>data.subarray(start,end+1)});
    try{
      const jpeg=await extractFrame(ffmpeg,source.url,0,AbortSignal.timeout(30000));assert.ok(jpeg.length>1000);assert.ok(jpeg.length<256*1024);
      const pixels=execFileSync(ffmpeg,['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:jpeg,windowsHide:true,timeout:10000});
      const mean=pixels.reduce((sum,n)=>sum+n,0)/pixels.length;
      const variance=pixels.reduce((sum,n)=>sum+(n-mean)**2,0)/pixels.length;
      assert.ok(mean>20&&variance>200,'Expected actual test scene after the black opening');
      console.log(JSON.stringify({fixture:extension,jpegBytes:jpeg.length,sourceBytes:source.stats.bytes,requests:source.stats.requests}));
    }finally{abort.abort();source.close();}
  }
  const filename=path.join(directory,'black.mp4');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=black:s=320x180:r=12:d=10','-c:v','libx264','-preset','ultrafast','-y',filename],{windowsHide:true,timeout:20000});
  const data=await readFile(filename),abort=new AbortController();
  const source=await openRangeSource({sizeBytes:data.length},{signal:abort.signal,readRange:async(start,end)=>data.subarray(start,end+1)});
  try{await assert.rejects(extractFrame(ffmpeg,source.url,0,AbortSignal.timeout(30000)));}finally{abort.abort();source.close();}
});

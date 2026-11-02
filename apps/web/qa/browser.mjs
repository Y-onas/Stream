const storagePath='/cache/storage.mjs',enginePath='/cache/engine.mjs';
const {SegmentStore}=await import(/* @vite-ignore */ storagePath);
const {RangeEngine,parseRange}=await import(/* @vite-ignore */ enginePath);
const output=document.querySelector('#results');
const log=text=>{output.textContent+=text+'\n';};
const check=(condition,label)=>{if(!condition)throw Error(label);log('PASS '+label);};
document.querySelector('#run').onclick=async()=>{
  output.textContent='';const store=new SegmentStore(indexedDB,'phonofilm-qa-disposable');
  try {
    await store.configure({clear:true,enabled:true});
    const size=10000,data=Uint8Array.from({length:size},(_,i)=>i%251);let calls=0;
    const fetcher=async(url,options)=>{if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),ETag:'"qa"'}});calls++;const r=parseRange(options.headers.Range,size);return new Response(data.slice(r.start,r.end+1),{status:206,headers:{'Content-Length':String(r.end-r.start+1),'Content-Range':`bytes ${r.start}-${r.end}/${size}`,ETag:'"qa"'}});};
    const engine=new RangeEngine({store,fetcher,segmentSize:1024});
    const read=async range=>{const res=await engine.respond(new Request(location.origin+'/api/videos/qa/stream',{headers:{Range:range}}));return new Uint8Array(await res.arrayBuffer());};
    const first=await read('bytes=1000-1100');check(first.length===101&&first.every((v,i)=>v===data[1000+i]),'Real IndexedDB: exact cross-segment bytes');
    await read('bytes=1010-1100');check(calls===2,'Overlapping range reused stored segments without network');
    await Promise.all([read('bytes=3000-3050'),read('bytes=3010-3060')]);check(calls===3,'Concurrent consumers shared one missing segment');
    await store.configure({clear:true});check((await store.settings()).total===0,'Clear removed disposable cache');
    log('Browser storage checks complete.');
  }catch(e){log('FAIL '+e.message);}
};
document.querySelector('#live').onclick=async()=>{
  output.textContent='';
  try{
    log('Registering service worker…');
    await navigator.serviceWorker.register('/sw.js',{type:'module'});await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller){log('Reload this page once, then rerun the live check.');return;}
    log('Loading local catalogue…');
    const catalogue=await (await fetch('/api/videos')).json();const video=catalogue.items[0];if(!video)throw Error('No locally selected video');
    const url=`/api/videos/${video.id}/stream`;
    const get=async range=>{const res=await fetch(url,{headers:{Range:range}});const bytes=new Uint8Array(await res.arrayBuffer());return {res,bytes};};
    log('Reading first range…');
    const a=await get('bytes=0-1023');check(a.res.status===206&&a.bytes.length===1024,'Real Telegram through service worker: 206 and exactly 1,024 bytes');
    const b=await get('bytes=100-199');check(b.bytes.length===100&&b.bytes.every((v,i)=>v===a.bytes[100+i]),'Overlapping cached bytes match');
    const c=await get('bytes=1048563-1048607');check(c.res.status===206&&c.bytes.length===45,'Real range crosses browser and Telegram 1 MiB boundary');
    const d=await get('bytes=1048563-1048607');check(d.bytes.every((v,i)=>v===c.bytes[i]),'Repeated range returns identical bytes');
    const state=await new SegmentStore().settings();check(state.total>=2*1024*1024,'Segments exist in this browser’s IndexedDB');
    log('Live checks complete. Verify the Go log contains no additional GETs for cached repeats.');
  }catch(e){log('FAIL '+e.message);const channel=new MessageChannel();channel.port1.onmessage=event=>{log('Worker diagnostic: '+JSON.stringify(event.data));channel.port1.close();};navigator.serviceWorker.controller?.postMessage({type:'CACHE_STATUS'},[channel.port2]);}
};
// A local, visibly labeled synthetic clip tests browser decoding independently of
// the Telegram MKV codec. It is never added to the real catalogue or uploaded.
document.querySelector('#clip').onclick=async()=>{
  output.textContent='Creating an eight-second synthetic test clip locally…\n';
  try{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const context=canvas.getContext('2d'),stream=canvas.captureStream(10),chunks=[];
    const mime=['video/mp4','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    const recorder=new MediaRecorder(stream,{mimeType:mime});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const stopped=new Promise(resolve=>recorder.onstop=resolve);
    let frame=0;const timer=setInterval(()=>{context.fillStyle='#13130f';context.fillRect(0,0,320,180);context.fillStyle='#eda630';context.fillRect((frame++*4)%280,80,40,40);context.font='15px sans-serif';context.fillText('Habeshan HUB · synthetic test clip',20,35);},100);
    recorder.start();await new Promise(resolve=>setTimeout(resolve,8000));recorder.stop();await stopped;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
    const blob=new Blob(chunks,{type:mime});const {mountPlayer}=await import('./PlayerHarness.jsx');mountPlayer(blob);
    log('Synthetic clip ready below. This is not Telegram integration evidence.');
  }catch(e){log('FAIL '+e.message);}
};

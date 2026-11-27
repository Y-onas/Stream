import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn,execFileSync} from 'node:child_process';
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',ffmpeg=process.env.FFMPEG_PATH||path.resolve('.tools/ffmpeg/bin/ffmpeg.exe');

test('real browser coalesces +10s taps and recovers transient Range failures at the requested time',{skip:process.env.RUN_BROWSER_TESTS!=='1'||!existsSync(chrome)||!existsSync(ffmpeg),timeout:90000},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'hh-seeking-')),clip=path.join(directory,'fixture.mp4'),profile=path.join(directory,'browser');
 let child;t.after(async()=>{child?.kill();await new Promise(resolve=>setTimeout(resolve,500));assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 // Test-only synthetic media; production originals are never transcoded/cached.
 execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12:d=120','-c:v','libx264','-preset','ultrafast','-crf','26','-g','12','-pix_fmt','yuv420p','-movflags','+faststart','-an','-y',clip],{windowsHide:true,timeout:20000});
 const bytes=await readFile(clip),video={id:randomUUID(),title:'Seeking fixture',filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:bytes.length,durationSeconds:120,uploadedAt:new Date().toISOString(),accessType:'FREE'},id=randomUUID(),stream=`/api/playback/${id}/stream`,assets=path.resolve('apps/web/dist');
 let authorizations=0,getFailures=0,headFailures=0,rejected=0,mediaRequests=0,headRequests=0;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.test'),send=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try{
   if(url.pathname===stream){
    const head=req.method==='HEAD';if(head)headRequests++;else mediaRequests++;
    if(head?headFailures>0:getFailures>0){if(head)headFailures--;else{getFailures--;rejected++;}res.statusCode=503;res.setHeader('Retry-After','0');return send({code:'SESSION_UPSTREAM_LIMIT'});}
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;
    if(start>end||start>=bytes.length){res.statusCode=416;return res.end();}
    res.writeHead(range&&!head?206:200,{'Content-Type':'video/mp4','Content-Length':head?bytes.length:end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store',...(range&&!head?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});
    if(head)return res.end();let offset=start;
    const write=()=>{if(offset>end){clearInterval(timer);res.end();return;}const next=Math.min(end+1,offset+4096);res.write(bytes.subarray(offset,next));offset=next;};
    const timer=setInterval(write,50);res.once('close',()=>clearInterval(timer));write();return;
   }
   if(url.pathname==='/api/auth/me')return send({user:null,membership:null,csrfToken:'fixture'});
   if(url.pathname==='/api/config')return send({platformName:'Seeking fixture'});
   if(url.pathname==='/api/videos')return send({items:[video],total:1});
   if(url.pathname==='/api/playback/authorize'){authorizations++;return send({id,sequence:0,position:0,expiresAt:new Date(Date.now()+300000).toISOString(),streamUrl:stream});}
   if(url.pathname.endsWith('/renew'))return send({id,expiresAt:new Date(Date.now()+300000).toISOString()});
   if(url.pathname.endsWith('/terminate'))return send({terminated:true});
   if(url.pathname.endsWith('/heartbeat'))return send({counted:false});
   if(url.pathname.endsWith('/comments'))return send({available:true,items:[],total:0,nextOffset:null});
   if(url.pathname.startsWith('/api/'))return send({items:[]});
   if(url.pathname==='/sw.js'){res.statusCode=404;return res.end();}
   const file=url.pathname.startsWith('/assets/')?path.resolve(assets,'.'+url.pathname):path.join(assets,'index.html');assert.ok(file.startsWith(assets+path.sep));res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));
  }catch{if(!res.headersSent)res.statusCode=500;res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const wait=async(check,label)=>{for(let n=0;n<300;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(label||'seeking condition timed out');};
 let debugPort;await wait(async()=>{try{debugPort=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debugPort>0;}catch{return false;}});
 const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(),socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await once(socket,'open');t.after(()=>socket.close());let next=0;const pending=new Map();
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(Error(data.error.message)):task.resolve(data.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined);return result.result.value;};
 await cdp('Page.enable');await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/video/${video.id}`});
 await wait(()=>evaluate('!!document.querySelector("video")&&document.querySelectorAll(".player-skip").length===2&&[...document.querySelectorAll(".player-skip")].every(button=>!button.disabled)'),'initial metadata');
 await evaluate('window.seekingFixture=document.querySelector("video");window.seekingFixture.pause();window.seekingFixture.currentTime=0;window.actualSeeks=0;window.seekingFixture.addEventListener("seeking",()=>window.actualSeeks++);true');
 getFailures=2;headFailures=1;
 await evaluate('(()=>{const next=[...document.querySelectorAll(".player-skip")].find(button=>button.dataset.seek==="forward");for(let n=0;n<8;n++)next.click();return true;})()');
 await wait(()=>rejected===2,'transient failures exercised');
 await wait(()=>evaluate('(()=>{const el=document.querySelector("video");return el&&!el.error&&el.currentTime>=79&&el.currentTime<=81&&el.readyState>=2;})()'),'automatic recovery at the latest target');
 assert.equal(await evaluate('!!document.querySelector(".player-error")'),false);assert.equal(authorizations,1,'recovery must reuse its authorized playback session');assert.ok(headRequests>=1);assert.ok(mediaRequests<12,'click bursts must not create an unbounded request storm');
 assert.equal(await evaluate('document.querySelector("video")===window.seekingFixture'),true);assert.equal(await evaluate('document.querySelector("video").paused'),true,'a paused video must stay paused');
 await evaluate('document.querySelector("video").play().then(()=>true)');await wait(()=>evaluate('!document.querySelector("video").paused'));
 getFailures=1;await evaluate('(()=>{const next=[...document.querySelectorAll(".player-skip")].find(button=>button.dataset.seek==="forward");next.click();next.click();return true;})()');
 await wait(()=>rejected===3,'playing seek failure exercised');await wait(()=>evaluate('(()=>{const el=document.querySelector("video");return el&&!el.error&&!el.paused&&el.currentTime>=99&&el.readyState>=2;})()'),'play intent restored after recovery');
 assert.equal(await evaluate('!!document.querySelector(".player-error")'),false);assert.equal(authorizations,1);
});

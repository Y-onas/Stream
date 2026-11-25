import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';

const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('real browser: silent VIP authorization, renewal, denial and navigation cleanup',{skip:process.env.RUN_BROWSER_TESTS!=='1'||!existsSync(chrome),timeout:90000},async t=>{
 const active=new Set(),events=[],userId=randomUUID();let delayNext=false,shortGrant=true,entitled=true,signedIn=true,accountFailure=false,denial=null,renewalDenial=null,accountRequests=0,renewals=0,mediaRequests=0;
 const membership={id:randomUUID(),status:'ACTIVE',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const videos=Array.from({length:3},(_,n)=>({id:randomUUID(),title:`Navigation fixture ${n}`,filename:'fixture.mp4',mimeType:'video/mp4',sizeBytes:1024,durationSeconds:120,uploadedAt:new Date().toISOString(),accessType:'VIP'}));
 const assets=path.resolve('apps/web/dist');
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://fixture.test');
   if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const send=data=>res.end(JSON.stringify(data));
    if(url.pathname==='/api/auth/me'){accountRequests++;if(accountFailure){res.statusCode=503;return send({message:'Temporary fixture outage.'});}return send({user:signedIn?{id:userId,username:'FixtureViewer'}:null,membership:signedIn&&entitled?membership:null,csrfToken:'fixture'});}
    if(url.pathname==='/api/config')return send({platformName:'Navigation fixture',registrationOpen:true});
    if(url.pathname==='/api/me/library')return send({userId,savedIds:[],likedIds:[],counts:{watched:0,liked:0,saved:0},membership:entitled?membership:null});
    if(url.pathname==='/api/videos')return send({items:videos,total:videos.length});
    if(url.pathname.endsWith('/trending'))return send({available:true,period:'day',items:[]});
    if(url.pathname==='/api/playback/authorize'){
     const bytes=[];for await(const chunk of req)bytes.push(chunk);const body=JSON.parse(Buffer.concat(bytes));
     events.push({type:'authorize',video:body.videoId,priorActive:active.size});
     const needsVip=videos.find(video=>video.id===body.videoId)?.accessType==='VIP';
     if(denial||(needsVip&&(!entitled||!signedIn))){res.statusCode=denial?.status||403;return send(denial||{code:'MEMBERSHIP_REQUIRED',message:'An active VIP membership is required.'});}
     if(active.size>=2){res.statusCode=429;return send({message:'Two VIP videos are already active.',code:'VIP_STREAM_LIMIT'});}
     const id=randomUUID();active.add(id);if(delayNext){delayNext=false;await new Promise(resolve=>setTimeout(resolve,400));}
     const expiresAt=new Date(Date.now()+(shortGrant?45000:300000)).toISOString();shortGrant=false;
     return send({id,sequence:0,position:0,expiresAt,streamUrl:`/api/playback/${id}/stream`});
    }
    const renewal=/^\/api\/playback\/([^/]+)\/renew$/.exec(url.pathname);
    if(renewal){renewals++;if(renewalDenial){active.delete(renewal[1]);res.statusCode=renewalDenial.status;return send(renewalDenial);}return send({id:renewal[1],expiresAt:new Date(Date.now()+300000).toISOString()});}
    const termination=/^\/api\/playback\/([^/]+)\/terminate$/.exec(url.pathname);
    if(termination){active.delete(termination[1]);events.push({type:'terminate',id:termination[1]});return send({terminated:true});}
    if(url.pathname.endsWith('/heartbeat'))return send({counted:false});
    if(url.pathname.endsWith('/stream'))mediaRequests++;
    if(url.pathname.endsWith('/stream')||url.pathname.endsWith('/thumbnail')){res.statusCode=503;return send({message:'No media in this navigation fixture.'});}
    if(url.pathname.endsWith('/comments'))return send({available:true,items:[],total:0,nextOffset:null});
    if(url.pathname.endsWith('/progress'))return send({progress:null});
    return send({items:[]});
   }
   if(url.pathname==='/sw.js'){res.statusCode=404;return res.end();}
   const file=url.pathname.startsWith('/assets/')?path.resolve(assets,'.'+url.pathname):path.join(assets,'index.html');
   assert.ok(file.startsWith(assets+path.sep));
   res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));
  }catch{if(!res.headersSent)res.statusCode=500;res.end();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const profile=await mkdtemp(path.join(tmpdir(),'hh-navigation-'));
 const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 t.after(async()=>{child.kill();await new Promise(resolve=>setTimeout(resolve,500));assert.ok(path.resolve(profile).startsWith(path.resolve(tmpdir())+path.sep));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const wait=async check=>{for(let n=0;n<150;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Browser navigation condition timed out');};
 let debugPort;await wait(async()=>{try{debugPort=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debugPort>0;}catch{return false;}});
 const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(),socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await once(socket,'open');t.after(()=>socket.close());let next=0;const pending=new Map();
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const task=pending.get(data.id);pending.delete(data.id);data.error?task.reject(Error(data.error.message)):task.resolve(data.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true});assert.equal(result.exceptionDetails,undefined);return result.result.value;};
 const click=async selector=>{await wait(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`));return evaluate(`(()=>{const link=document.querySelector(${JSON.stringify(selector)});if(!link)return false;link.click();return true;})()`);};
 await cdp('Page.enable');await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 await wait(()=>evaluate(`!!document.querySelector('a[href="/video/${videos[0].id}"]')`));
 const initialAccountRequests=accountRequests;delayNext=true;
 for(const [index,video]of videos.entries()){
  assert.equal(await click(`a[href="/video/${video.id}"]`),true);await wait(()=>active.size===1);
  await wait(()=>evaluate('!!document.querySelector(".player-frame")'));
  const view=await evaluate('({player:!!document.querySelector(".player-frame"),gate:!!document.querySelector(".membership-gate"),text:document.body.innerText})');
  assert.equal(view.player&&!view.gate&&!/checking playback access|are you vip/i.test(view.text),true,JSON.stringify({index,...view}));
  if(index===0){
   assert.equal(await evaluate('!!document.querySelector("video")'),false);
   assert.equal(mediaRequests,0,'no browser media request before the grant');
   await wait(()=>evaluate('!!document.querySelector("video")'));
   await evaluate('window.fixturePlayer=document.querySelector("video");true');accountFailure=true;
   await evaluate('dispatchEvent(new Event("focus"))');await wait(()=>renewals===1&&accountRequests>initialAccountRequests);
   assert.equal(await evaluate('document.querySelector("video")===window.fixturePlayer&&!document.querySelector(".membership-gate")'),true);
   assert.equal(events.filter(event=>event.type==='authorize').length,1);assert.equal(events.filter(event=>event.type==='terminate').length,0);accountFailure=false;
  }
  await wait(()=>evaluate('!!document.querySelector("a.back-link")'));assert.equal(await click('a.back-link'),true);await wait(()=>active.size===0);
 }
 delayNext=true;assert.equal(await click(`a[href="/video/${videos[0].id}"]`),true);await wait(()=>active.size===1);
 await wait(()=>evaluate('!!document.querySelector("a.back-link")'));assert.equal(await click('a.back-link'),true);
 await wait(()=>evaluate(`!!document.querySelector('a[href="/video/${videos[1].id}"]')`));assert.equal(await click(`a[href="/video/${videos[1].id}"]`),true);
 await wait(()=>events.filter(event=>event.type==='authorize').length===5&&active.size===1);
 assert.equal(await click('a.back-link'),true);await wait(()=>active.size===0);
 assert.equal(events.filter(event=>event.type==='terminate').length,5);
 assert.equal(accountRequests,initialAccountRequests+1,'movie navigation must not refetch membership');
 assert.ok(events.filter(event=>event.type==='authorize').every(event=>event.priorActive===0));
 assert.equal(await evaluate('sessionStorage.length'),0);
 // A full document departure uses pagehide/keepalive, not React route cleanup.
 assert.equal(await click(`a[href="/video/${videos[2].id}"]`),true);
 await wait(()=>evaluate('!!document.querySelector("video")'));
 assert.equal(active.size,1);await cdp('Page.navigate',{url:'about:blank'});await wait(()=>active.size===0);
 assert.equal(events.filter(event=>event.type==='terminate').length,6);
 // Reload restores the authenticated account; playback still opens directly.
 await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/video/${videos[0].id}`});
 await wait(()=>evaluate('!!document.querySelector("video")'));
 assert.equal(await evaluate('!!document.querySelector(".membership-gate")'),false);
 assert.equal(await click('a.back-link'),true);await wait(()=>active.size===0);
 // An expired/revoked playback session is a playback error, not an upgrade.
 denial={status:401,code:'PLAYBACK_SESSION_REVOKED',message:'This playback session was ended.'};
 assert.equal(await click(`a[href="/video/${videos[1].id}"]`),true);
 await wait(()=>evaluate('document.querySelector(".player-error")?.innerText.includes("This playback session was ended.")'));
 assert.equal(await evaluate('!!document.querySelector(".membership-gate")'),false);
 assert.equal(await click('a.back-link'),true);denial=null;entitled=false;
 // A known non-member is gated immediately, without initializing a player.
 const beforeNonMemberRefresh=accountRequests;await evaluate('dispatchEvent(new Event("focus"))');await wait(()=>accountRequests>beforeNonMemberRefresh);
 await wait(()=>evaluate('!!document.querySelector(".vip-locked")'));
 const beforeNonMember={authorizations:events.filter(event=>event.type==='authorize').length,media:mediaRequests};
 assert.equal(await click(`a[href="/video/${videos[2].id}"]`),true);
 await wait(()=>evaluate('!!document.querySelector(".membership-gate .gold-button")'));
 assert.equal(await evaluate('document.querySelector(".membership-gate .gold-button").getAttribute("href")'),`/premium?video=${videos[2].id}`);
 assert.equal(await evaluate('!!document.querySelector("video")?.getAttribute("src")'),false);
 assert.equal(await evaluate('!!document.querySelector("video")'),false);
 await new Promise(resolve=>setTimeout(resolve,200));assert.equal(mediaRequests,beforeNonMember.media);assert.equal(events.filter(event=>event.type==='authorize').length,beforeNonMember.authorizations);
 // Approval is learned by existing account/library refresh, without a prompt.
 await evaluate('dispatchEvent(new Event("focus"))');await wait(()=>accountRequests>=initialAccountRequests+3);
 await new Promise(resolve=>setTimeout(resolve,100));entitled=true;
 await evaluate('dispatchEvent(new Event("focus"))');
 await wait(()=>evaluate('!!document.querySelector("video")'));
 assert.equal(await evaluate('!!document.querySelector(".membership-gate")'),false);
 // A real revocation stops the player and presents a single membership option.
 entitled=false;renewalDenial={status:410,code:'PLAYBACK_SESSION_EXPIRED',message:'Playback session expired. Start playback again.'};
 await evaluate('dispatchEvent(new Event("focus"))');
 await wait(()=>evaluate('!!document.querySelector(".membership-gate")'));
 assert.equal(await evaluate('document.querySelectorAll(".membership-gate").length'),1);
 assert.equal(await evaluate('!!document.querySelector("video")?.getAttribute("src")'),false);
 assert.equal(await click('a.back-link'),true);await wait(()=>active.size===0);
 // Guests get no VIP media element/URL either; public Free titles still work.
 signedIn=false;renewalDenial=null;const guestRefresh=accountRequests;await evaluate('dispatchEvent(new Event("focus"))');await wait(()=>accountRequests>guestRefresh);
 await new Promise(resolve=>setTimeout(resolve,100));
 const guestMedia=mediaRequests,guestAuthorizations=events.filter(event=>event.type==='authorize').length;
 assert.equal(await click(`a[href="/video/${videos[0].id}"]`),true);await wait(()=>evaluate('!!document.querySelector(".membership-gate")'));
 assert.equal(await evaluate('!!document.querySelector("video")'),false);await new Promise(resolve=>setTimeout(resolve,200));assert.equal(mediaRequests,guestMedia);assert.equal(events.filter(event=>event.type==='authorize').length,guestAuthorizations);
 assert.equal(await click('a.back-link'),true);
 const free={...videos[0],id:randomUUID(),title:'Public Free fixture',accessType:'FREE'};videos.push(free);
 await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/video/${free.id}`});await wait(()=>evaluate('!!document.querySelector("video")'));
 assert.equal(await evaluate('!!document.querySelector(".membership-gate")'),false);
 assert.equal(await click('a.back-link'),true);await wait(()=>active.size===0);
});

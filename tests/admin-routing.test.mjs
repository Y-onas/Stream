import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {applicationConfig} from '../services/api/src/config.mjs';

test('development and preview legacy admin URLs return 404 without revealing the console',{timeout:20000},async t=>{
 const {createServer,preview}=await import('vite'),root=path.resolve('apps/admin'),configFile=path.join(root,'vite.config.mjs');
 async function port(){const server=http.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
 const dev=await createServer({root,configFile,logLevel:'silent',server:{host:'127.0.0.1',port:await port(),strictPort:true,hmr:false}});await dev.listen();t.after(()=>dev.close());
 const built=await preview({root,configFile,logLevel:'silent',preview:{host:'127.0.0.1',port:await port(),strictPort:true}});t.after(()=>new Promise(resolve=>{built.httpServer.closeAllConnections();built.httpServer.close(resolve);}));
 for(const server of [dev.httpServer,built.httpServer]){
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const old of ['/','/admin','/admin/','/admin/login','/admin?next=dashboard']){const response=await fetch(base+old,{redirect:'manual',signal:AbortSignal.timeout(5000)});assert.equal(response.status,404,old);assert.equal(response.headers.get('location'),null);assert.equal((await response.text()).includes('hub-console'),false);}
  const login=await fetch(base+'/hub-console/login');assert.equal(login.status,200);assert.ok(login.headers.get('x-robots-tag').includes('noindex'));await login.text();
 }
});

test('actual Caddy admin paths, indexing controls, undisclosed legacy routes and credential log redaction',{skip:process.env.RUN_CADDY_TESTS!=='1',timeout:120000},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'hh-admin-routes-'));
 const trace=message=>{if(process.env.DEBUG_ADMIN_ROUTING==='1')console.log(message);};
 const nativeFetch=globalThis.fetch,fetch=(url,options={})=>nativeFetch(url,{...options,signal:AbortSignal.timeout(5000)});
 const binary=path.resolve(process.env.CADDY_PATH||'.tools/caddy/caddy.exe'),host='127.0.0.1',children=[];t.after(async()=>{for(const child of children)child.kill();await new Promise(resolve=>setTimeout(resolve,300));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const port=async()=>{const server=http.createServer();server.listen(0,host);await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;};
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function start(name,source){
  const file=path.join(directory,name+'.Caddyfile');await writeFile(file,'{\n admin off\n auto_https off\n persist_config off\n}\n'+source);
  const child=spawn(binary,['run','--adapter','caddyfile','--config',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('error',()=>{});
  return{child,logs:()=>logs};
 }
 async function ready(url,child){for(let n=0;n<100;n++){if(child.exitCode!==null)assert.fail('Local Caddy exited before readiness');try{if((await fetch(url+'/healthz')).ok)return;}catch{}await pause(50);}assert.fail('Local Caddy did not become ready');}
 const publicKey=applicationConfig().clerkPublishableKey;
 const api=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');if(req.url==='/healthz'){res.end(JSON.stringify({ready:true,database:true,telegram:true}));return;}if(req.url==='/api/admin/config'){res.end(JSON.stringify({configured:!!publicKey,publishableKey:publicKey,provider:'google'}));return;}res.writeHead(401);res.end(JSON.stringify({message:'Sign in to the administrator application.'}));});api.listen(0,host);await once(api,'listening');t.after(()=>{api.closeAllConnections();api.close();});
 const staticPort=await port(),staticURL=`http://${host}:${staticPort}`;
 let source=await readFile('infrastructure/docker/static.Caddyfile','utf8');source=source.replace(':80 {',`http://${host}:${staticPort} {`).replaceAll('/srv/admin',path.resolve('apps/admin/dist').replaceAll('\\','/')).replaceAll('/srv/web',path.resolve('apps/web/dist').replaceAll('\\','/')).replace('  respond /healthz',`  handle /api/* {\n    reverse_proxy ${host}:${api.address().port}\n  }\n  respond /healthz`);
 // Caddyfile roots need quoting when the checked-out path contains spaces.
 source=source.replace(/root \* (.+)/g,(_,root)=>'root * '+JSON.stringify(root));
 trace('Starting isolated static Caddy');const staticServer=await start('static',source);await ready(staticURL,staticServer.child);
 trace('Checking built admin paths and assets');const bare=await fetch(staticURL+'/hub-console',{redirect:'manual'});assert.equal(bare.status,308);assert.equal(bare.headers.get('location'),'/hub-console/');
 const login=await fetch(staticURL+'/hub-console/login'),html=await login.text();assert.equal(login.status,200);assert.ok(login.headers.get('x-robots-tag').includes('noindex'));assert.equal(login.headers.get('cache-control'),'no-store');assert.ok(html.includes('noindex, nofollow, noarchive'));
 const asset=/src="([^"]+\.js)"/.exec(html)?.[1];assert.ok(asset.startsWith('/hub-console/assets/'));assert.equal((await fetch(staticURL+asset)).status,200);
 const legacyPaths=['/admin','/admin/','/admin/login','/admin/users','/admin?next=dashboard','/%61dmin/login','/admin%2Flogin'];
 async function hiddenLegacy(root){for(const old of legacyPaths){const response=await fetch(root+old,{redirect:'manual'});assert.equal(response.status,404,old);assert.equal(response.headers.get('location'),null);assert.equal((await response.text()).includes('hub-console'),false);}}
 await hiddenLegacy(staticURL);
 const robots=await(await fetch(staticURL+'/robots.txt')).text();assert.equal(robots.includes('hub-console'),false);assert.equal(robots.includes('/admin'),false);assert.ok(!(await(await fetch(staticURL+'/')).text()).includes('/hub-console'));
 for(const file of ['Caddyfile','Caddyfile.coolify']){
  const number=await port(),root=`http://${host}:${number}`;let proxy=await readFile('infrastructure/docker/'+file,'utf8');proxy=proxy.replace(/^(?:http:\/\/)?\{\$PUBLIC_HOST\} \{/,`http://${host}:${number} {`).replaceAll('{$API_GATEWAY_TOKEN}','fixture-gateway-token').replaceAll('api:3000',`${host}:${api.address().port}`).replaceAll('web:80',`${host}:${staticPort}`);
  trace('Checking proxy '+file);const running=await start(file,proxy);await ready(root,running.child);
  await hiddenLegacy(root);
  const readiness=await fetch(root+'/readyz');assert.equal(readiness.status,200);assert.deepEqual(await readiness.json(),{ready:true,database:true,telegram:true});
  assert.equal((await fetch(root+'/hub-console/login')).status,200);
  const canary='admin-secret-canary-no-log';assert.equal((await fetch(root+'/api/admin/me?code='+canary,{headers:{Cookie:'fixture='+canary,Authorization:'Bearer '+canary,Referer:'https://example.test/?ticket='+canary,'X-CSRF-Token':canary}})).status,401);
  for(let n=0;n<30&&!running.logs().includes('"status":401');n++)await pause(50);
  assert.ok(running.logs().includes('"status":401'),'The real Caddy access log must be observed');assert.ok(!running.logs().includes(canary),'OAuth URLs, tokens, cookies and referrers must not enter access logs');
 }
 if(process.env.RUN_BROWSER_TESTS==='1')await t.test('rendered anonymous dashboard request navigates to the actual login route',async()=>{
  trace('Starting isolated browser');const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',profile=path.join(directory,'browser');
  const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});children.push(child);child.on('error',()=>{});
  let debugPort;for(let n=0;n<100;n++){try{debugPort=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}assert.ok(debugPort,'Isolated headless browser must start');
  trace('Browser debugger ready');const pages=await(await fetch(`http://${host}:${debugPort}/json/list`)).json(),page=pages.find(p=>p.type==='page'),socket=new WebSocket(page.webSocketDebuggerUrl);await once(socket,'open');t.after(()=>socket.close());let next=0;const waiting=new Map();socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const work=waiting.get(data.id);waiting.delete(data.id);data.error?work.reject(Error(data.error.message)):work.resolve(data.result);}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await cdp('Page.enable');await cdp('Page.navigate',{url:staticURL+'/hub-console/'});
  let state;for(let n=0;n<150;n++){const value=await cdp('Runtime.evaluate',{expression:'JSON.stringify({path:location.pathname,text:document.body?.innerText})',returnByValue:true});try{state=JSON.parse(value.result.value);}catch{}if(state?.text?.includes('Continue with Google')&&state.path==='/hub-console/login')break;await pause(200);}
  trace('Browser route: '+state?.path);assert.equal(state?.path,'/hub-console/login');assert.ok(state?.text?.includes('Continue with Google'),'Real Clerk bootstrap should render the Google login button');assert.ok(!state.text.includes('Refresh current records'));
  const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile('.local/qa/admin-login.png',Buffer.from(shot.data,'base64'));child.kill();
 });
});

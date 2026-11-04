// Explicit loopback-only, disposable integration environment. Not a production entrypoint.
import {createServer as viteServer} from 'vite';
import react from '@vitejs/plugin-react';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {isolatedDatabase} from '../tests/helpers/playback-database.mjs';
import {createApplication} from '../services/api/src/application.mjs';
import {createAPI} from '../services/api/src/server.mjs';
import {hash,token,hashPassword,cookie} from '../services/api/src/domain.mjs';
import {bootstrapAdministration} from '../services/api/src/settings.mjs';
import {seedPlans} from '../services/api/prisma/seed.mjs';
import {runtimeProxy} from '../apps/web/dev/runtime-proxy.mjs';
import {buildPlaybackFixture} from '../tests/helpers/build-playback-fixture.mjs';

const cleanups=[];
try{
const fixture=buildPlaybackFixture(),db=await isolatedDatabase({after:fn=>cleanups.push(fn)},'hh43_qa'),directory=path.resolve('.local/qa/module43');await mkdir(directory,{recursive:true});
const ffmpeg=process.env.FFMPEG_PATH||path.resolve('.tools/ffmpeg/bin/ffmpeg.exe'),media=path.join(directory,'disposable.mp4'),image=path.join(directory,'disposable.jpg');
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=12:d=65','-c:v','libx264','-crf','35','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','-y',media],{windowsHide:true,timeout:30000});
execFileSync(ffmpeg,['-v','error','-ss','5','-i',media,'-frames:v','1','-y',image],{windowsHide:true,timeout:15000});
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}),publicFile=path.join(directory,'public.pem');await writeFile(publicFile,publicKey);
const config={currency:'ETB',timezone:'Africa/Nairobi',supportUsername:'',adminOrigin:'http://localhost:5183',bootstrapEmail:'qa-owner@example.test',bootstrapName:'Disposable test owner',playbackPrivateKey:privateKey,playbackPublicKey:publicKey,playbackTTL:30};
await seedPlans(db,'ETB');await bootstrapAdministration(db,config);
const size=(await readFile(media)).length,jpeg=await readFile(image);
const vip=await db.video.create({data:{id:'qa-vip',title:'Disposable VIP playback test',filename:'disposable.mp4',mimeType:'video/mp4',sizeBytes:size,uploadedAt:new Date(),durationSeconds:65,accessType:'VIP'}});
const vip2=await db.video.create({data:{id:'qa-vip-2',title:'Disposable second VIP playback test',filename:'disposable.mp4',mimeType:'video/mp4',sizeBytes:size,uploadedAt:new Date(),durationSeconds:65,accessType:'VIP'}});
const free=await db.video.create({data:{id:'qa-free',title:'Disposable Free playback test',filename:'disposable.mp4',mimeType:'video/mp4',sizeBytes:size,uploadedAt:new Date(),durationSeconds:65,accessType:'FREE'}});
const user=await db.user.create({data:{username:'DisposableVIP',usernameCanonical:'disposablevip',displayName:'Disposable VIP test user',passwordHash:await hashPassword(token())}});
await db.membership.create({data:{userId:user.id,planId:'monthly',planName:'Disposable test membership',durationMonths:1,amountMinor:99000,currency:'ETB',activatedAt:new Date(),expiresAt:new Date(Date.now()+3600000),approvedByAdminId:'qa-owner',source:'MANUAL'}});
let goOrigin;const app=createApplication({db,config}),handler=createAPI({streamOrigin:'http://fixture',streamToken:'s'.repeat(40),gatewayToken:'g'.repeat(40),publicOrigin:'http://localhost:5183',application:app,thumbnails:{get:()=>({status:'ready',bytes:jpeg}),close(){}},fetcher:(url,options)=>fetch(new URL(url.pathname,goOrigin),options)});
const server=createServer(handler);server.listen(5188,'127.0.0.1');await once(server,'listening');
cleanups.push(()=>{server.closeAllConnections();server.close();});
const go=spawn(fixture,['-check-url','http://127.0.0.1:5188/internal/playback/check','-public-key',publicFile,'-media',media],{env:{...process.env,STREAM_SERVICE_TOKEN:'s'.repeat(40)},stdio:['ignore','pipe','pipe'],windowsHide:true});
cleanups.push(()=>{go.kill();});
goOrigin=await new Promise((resolve,reject)=>{let text='';go.once('error',reject);go.stdout.on('data',data=>{text+=data;const line=text.split('\n')[0].trim();if(/^http:\/\/127\.0\.0\.1:\d+$/.test(line))resolve(line);});go.once('exit',code=>reject(Error('Go fixture exited '+code)));});
process.env.APPLICATION_API_ORIGIN='http://127.0.0.1:5188';process.env.API_GATEWAY_TOKEN='g'.repeat(40);
const qa={name:'isolated-playback-qa',transformIndexHtml(html){return html.replace('<body>','<body><aside style="padding:8px;background:#3a2b12;color:#ffcf77;text-align:center;font:12px monospace">ISOLATED MODULE 4.3 TEST · synthetic clip · temporary database · no real payments<form action="/qa/member" method="post"><button style="margin:6px;border:1px solid #ab7c32;padding:6px 12px;color:inherit" type="submit">Use disposable VIP account</button></form></aside>');},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(req.url==='/qa/member'&&req.method==='POST'){
  if(req.headers.origin!=='http://localhost:5183'){res.writeHead(403);return res.end();}
  const value=token();await db.userSession.create({data:{userId:user.id,tokenHash:hash(value),csrfToken:token(),expiresAt:new Date(Date.now()+3600000)}});cookie(res,'hh_session',value);res.writeHead(303,{Location:'/'});return res.end();
 }next();});vite.middlewares.use(runtimeProxy({origin:'http://localhost:5183'}));}};
const vite=await viteServer({configFile:false,root:path.resolve('apps/web'),plugins:[react(),qa],envDir:false,server:{host:'127.0.0.1',port:5183,strictPort:true,cors:false,fs:{strict:true,allow:[path.resolve('apps/web'),path.resolve('node_modules')],deny:['**/.env*','**/.sessions/**','**/.local/**','**/services/**','**/.git/**']}}});await vite.listen();
cleanups.push(()=>vite.close());
await writeFile(path.join(directory,'state.json'),JSON.stringify({origin:'http://localhost:5183',schema:db.appSchema,vip:vip.publicId,vip2:vip2.publicId,free:free.publicId}));
console.log(JSON.stringify({event:'module43_browser_qa_ready',origin:'http://localhost:5183',syntheticMedia:true,isolatedDatabase:true}));
let closing=false;async function close(){if(closing)return;closing=true;for(const cleanup of cleanups.reverse())await cleanup();console.log('Disposable playback QA data removed.');process.exit(0);}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
process.stdin.on('data',chunk=>{if(chunk.toString().trim()==='stop')void close();});
}catch{
 for(const cleanup of cleanups.reverse())try{await cleanup();}catch{}
 console.error('Disposable playback QA could not start; check database, Go, FFmpeg and loopback ports.');process.exitCode=1;
}

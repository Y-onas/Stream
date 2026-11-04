import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const local=path.join(root,'.local');mkdirSync(local,{recursive:true});
const configPath=path.join(local,'runtime.json');
if(!existsSync(configPath))writeFileSync(configPath,JSON.stringify({apiOrigin:'http://127.0.0.1:3000',streamOrigin:'http://127.0.0.1:8081',streamToken:randomBytes(32).toString('hex'),gatewayToken:randomBytes(32).toString('hex')},null,2),{mode:0o600,flag:'wx'});
const settings=JSON.parse(readFileSync(configPath,'utf8'));
const env={...process.env,STREAM_ORIGIN:settings.streamOrigin,STREAM_LISTEN:new URL(settings.streamOrigin).host,STREAM_SERVICE_TOKEN:settings.streamToken,API_GATEWAY_TOKEN:settings.gatewayToken,PUBLIC_ORIGIN:'http://127.0.0.1:5173',API_PORT:new URL(settings.apiOrigin).port};
env.PLAYBACK_PUBLIC_KEY_PATH ||= path.join(local,'playback-public.pem');
env.PLAYBACK_PRIVATE_KEY_PATH ||= path.join(local,'playback-private.pem');
env.PLAYBACK_CHECK_URL ||= settings.apiOrigin+'/internal/playback/check';
const portableFFmpeg=path.join(root,'.tools/ffmpeg/bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
if(!env.FFMPEG_PATH&&existsSync(portableFFmpeg))env.FFMPEG_PATH=portableFFmpeg;
const [action]=process.argv.slice(2);const windows=process.platform==='win32';
if(action==='build'){
  const localGo=path.join(root,'.tools/go/bin',windows?'go.exe':'go');
  if(existsSync(localGo)){env.GOPATH=path.join(root,'.tools/gopath');env.GOCACHE=path.join(root,'.tools/gocache');}
  const p=spawn(existsSync(localGo)?localGo:'go',['build','-o',path.join(root,'bin',windows?'stream-service.exe':'stream-service'),'./cmd/stream-service'],{cwd:path.join(root,'services/stream-go'),env,stdio:'inherit'});p.on('exit',code=>process.exitCode=code??1);
}else if(action==='go'||action==='api'){
  const p=action==='go'?spawn(path.join(root,'bin',windows?'stream-service.exe':'stream-service'),[],{env,stdio:'inherit'}):spawn(process.execPath,['services/api/src/server.mjs'],{env,stdio:'inherit'});
  p.on('error',()=>{console.error('Runtime could not start; check build and configuration.');process.exitCode=1;});p.on('exit',code=>process.exitCode=code??1);
}else throw Error('Use build, go or api');

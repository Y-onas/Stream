import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createThumbnailService} from './thumbnails.mjs';
import {applicationConfig} from './config.mjs';
import {createDatabase} from './database.mjs';
import {createApplication} from './application.mjs';
import {startCatalogueSync} from './catalogue-sync.mjs';
import {body,HttpError} from './domain.mjs';
import {reportSource} from './source-status.mjs';
import {validateProductionEnvironment,ConfigurationError} from './production-config.mjs';

const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
const unavailable=name=>({available:false,code:'NOT_IMPLEMENTED',message:`${name} requires the application data service.`,items:[]});
const equal=(a,b)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createAPI({streamOrigin,streamToken,gatewayToken='',publicOrigin,fetcher=(...args)=>fetch(...args),production=false,application=null,thumbnails=createThumbnailService({streamOrigin,streamToken,fetcher,grantFor:video=>application.playback.internalGrant(video),jobLease:()=>application?.playback.metadataLease()})}) {
  const target=new URL(streamOrigin);
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('Invalid STREAM_ORIGIN');
  if(!streamToken || streamToken.length<32 || (production&&gatewayToken.length<32))throw Error('Missing service authentication');
  if(production&&!publicOrigin)throw Error('PUBLIC_ORIGIN is required');
  application?.operations?.setGoProbe(async()=>{const response=await fetcher(new URL('/internal/metrics',target),{headers:{Authorization:`Bearer ${streamToken}`},signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error();return response.json();});
  const totals=application?.operations?.requests||{total:0,failed:0,authorizationFailures:0,interrupted:0};let nextDependencyLog=0;
  const logTimer=setInterval(()=>console.log(JSON.stringify({event:'api_request_totals',...totals})),60000);logTimer.unref();
  let inFlight=0;
  const handler=async(req,res)=>{
    // Bound short control/API work, not the number of open video responses.
    // Long media bodies must never turn this into a global viewer ceiling.
    const mediaRequest=['GET','HEAD'].includes(req.method)&&/^\/api\/playback\/[\w-]+\/stream(?:\?|$)/.test(req.url);
    if(!mediaRequest){
      if(inFlight>=32)return json(res,503,{message:'Application requests are temporarily busy. Please retry shortly.'});
      inFlight++;let released=false;const release=()=>{if(!released){released=true;inFlight--;}};res.once('finish',release);res.once('close',release);
    }
    let finished=false;res.on('finish',()=>{finished=true;totals.total++;if(res.statusCode>=400)totals.failed++;if([401,403].includes(res.statusCode))totals.authorizationFailures++;});res.on('close',()=>{if(!finished){totals.total++;totals.failed++;totals.interrupted++;}});
    const controller=new AbortController();res.on('close',()=>controller.abort());
    const upstream=(path,options={})=>fetcher(new URL(path,target),{...options,headers:{Authorization:`Bearer ${streamToken}`,...options.headers},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(options.timeout||10000)])});
    try{
      const url=new URL(req.url,'http://api.internal');
      if(url.pathname==='/api/admin'||url.pathname.startsWith('/api/admin/'))res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
      // This private endpoint is never exposed by the public reverse proxy.
      if(url.pathname==='/internal/playback/check'){
        if(!equal(String(req.headers.authorization||''),'Bearer '+streamToken))throw new HttpError(401,'Unauthorized');
        if(req.method!=='POST'||!application)throw new HttpError(503,'Playback verification is unavailable.');
        const data=await body(req);return json(res,200,await application.playback.introspect(data.grant,data.active===true,data.reservationId));
      }
      if(['/internal/playback/release','/internal/playback/work'].includes(url.pathname)){
        if(!equal(String(req.headers.authorization||''),'Bearer '+streamToken))throw new HttpError(401,'Unauthorized');
        if(req.method!=='POST'||!application)throw new HttpError(503,'Playback verification is unavailable.');
        const data=await body(req);return json(res,200,await application.playback.capacity[url.pathname.endsWith('/work')?'discovery':'release'](data.reservationId));
      }
      if(url.pathname==='/internal/playback/source'){
        if(!equal(String(req.headers.authorization||''),'Bearer '+streamToken))throw new HttpError(401,'Unauthorized');
        if(req.method!=='POST'||!application)throw new HttpError(503,'Source status is unavailable.');
        return json(res,200,await reportSource(application.db,await body(req)));
      }
      if(url.pathname==='/livez'&&req.method==='GET')return json(res,200,{alive:true});
      if(url.pathname==='/healthz'&&req.method==='GET'){const ready=await upstream('/readyz');const databaseReady=application?await application.health().catch(()=>false):false;return json(res,ready.ok&&databaseReady?200:503,{ready:ready.ok&&databaseReady,telegram:ready.ok,database:databaseReady});}
      if(gatewayToken&&!equal(String(req.headers['x-gateway-token']||''),gatewayToken))return json(res,401,{message:'Unauthorized'});
      const localHost=`127.0.0.1:${req.socket.localPort}`;
      if(!production && publicOrigin && ![new URL(publicOrigin).host,localHost].includes(req.headers.host))return json(res,403,{message:'Unexpected host'});
      const allowedOrigins=(url.pathname==='/api/admin'||url.pathname.startsWith('/api/admin/'))?[application?.config.adminOrigin||publicOrigin]:[publicOrigin];
      if((req.headers.origin&&!allowedOrigins.includes(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site'){application?.security?.record('UNTRUSTED_ORIGIN');return json(res,403,{message:'Same-origin access required'});}
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!req.headers.origin||!allowedOrigins.includes(req.headers.origin))){application?.security?.record('UNTRUSTED_ORIGIN');return json(res,403,{message:'Same-origin access required'});}
      if(!application)throw new HttpError(503,'The application data service is not configured.');
      const stream=/^\/api\/playback\/([\w-]+)\/stream$/.exec(url.pathname);
      if(!stream){
        // Knowing a catalogue ID never permits bypassing playback authorization.
        if(/^\/api\/videos\/[^/]+\/stream$/.test(url.pathname))throw new HttpError(401,'Request playback authorization first.','PLAYBACK_AUTHORIZATION_REQUIRED');
        if(await application.handle(req,res,url))return;
        const image=/^\/api\/videos\/([\w-]+)\/(thumbnail|artwork)$/.exec(url.pathname);
        if(!image||!['GET','HEAD'].includes(req.method))throw new HttpError(404,'Not found');
        if(url.search)throw new HttpError(400,'Image query parameters are not supported.');
        const video=await application.authorizeMedia(req,res,image[1]);
        if(image[2]==='artwork')throw new HttpError(404,'No artwork available.');
        const preview=thumbnails.get({...video,sizeBytes:Number(video.sizeBytes)},{generate:req.method==='GET'});
        if(preview.status==='ready'){
          res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':preview.bytes.length,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
          return res.end(req.method==='HEAD'?undefined:preview.bytes);
        }
        if(preview.status==='pending'||preview.status==='busy'){res.setHeader('Retry-After','3');return json(res,202,{status:'pending'});}
        throw new HttpError(404,'No suitable video preview available.');
      }
      if(!['GET','HEAD'].includes(req.method)||url.search||req.headers['transfer-encoding']||Number(req.headers['content-length']||0)>0)throw new HttpError(400,'Invalid stream request.');
      const authorization=await application.playback.stream(req,res,stream[1]);
      const headers={'X-Playback-Grant':authorization.grant};for(const key of ['range','if-range','if-match'])if(req.headers[key])headers[key]=req.headers[key];
      const media=await upstream('/internal/videos/'+authorization.videoId+'/stream',{method:req.method,headers,timeout:4*3600000});
      const output={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
      for(const key of ['content-type','content-length','content-range','accept-ranges','etag','retry-after'])if(media.headers.has(key))output[key]=media.headers.get(key);
      res.writeHead(media.status,output);
      if(req.method==='HEAD'||!media.body){await media.body?.cancel();return res.end();}
      const reader=media.body.getReader();
      try{while(true){const {value,done}=await reader.read();if(done)break;if(!res.write(value))await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',drain);res.off('close',close);};const drain=()=>{cleanup();resolve();};const close=()=>{cleanup();reject(Error('Client disconnected'));};res.once('drain',drain);res.once('close',close);});}res.end();}
      catch{await reader.cancel().catch(()=>{});res.destroy();}
    }catch(error){
      application?.security?.record(({VIP_STREAM_LIMIT:'VIP_STREAM_LIMIT',SESSION_UPSTREAM_LIMIT:'SESSION_REQUEST_LIMIT',MEMORY_PRESSURE:'RESOURCE_PRESSURE',MEMBERSHIP_REQUIRED:'VIP_DENIED',PLAYBACK_GRANT_INVALID:'INVALID_GRANT',PLAYBACK_GRANT_EXPIRED:'EXPIRED_GRANT',PLAYBACK_SESSION_REVOKED:'REVOKED_SESSION',PLAYBACK_SESSION_EXPIRED:'EXPIRED_SESSION',PLAYBACK_GRANT_SCOPE:'CROSS_VIDEO',PLAYBACK_ACCESS_CHANGED:'ACCESS_CHANGED'})[error.code]);
      if(!error.status&&Date.now()>=nextDependencyLog){nextDependencyLog=Date.now()+10000;console.log(JSON.stringify({event:'api_dependency_error',code:/^P\d{4}$/.test(error.code||'')?error.code:'DEPENDENCY_ERROR'}));}
      if(!res.headersSent&&['P2034','P2002'].includes(error.code))return json(res,409,{message:'A conflicting update occurred. Refresh the record and try again.'});
      if(!res.headersSent)json(res,error.status||503,{message:error.status?error.message:'Application service is temporarily unavailable. Please retry shortly.',...(error.status&&error.code?{code:error.code}:{})});else res.destroy();
    }
  };
  handler.close=async()=>{clearInterval(logTimer);thumbnails.close();await application?.close();};return handler;
}
export function start(){
  const production=process.env.NODE_ENV==='production';
  const config=applicationConfig();if(production)validateProductionEnvironment(process.env,config);
  const application=process.env.DATA_BASE_URL?createApplication({db:createDatabase(),config,production}):null;
  if(production&&!application?.playback.grants.configured)throw Error('Playback signing keys are required in production');
  const sync=application?startCatalogueSync({db:application.db,streamOrigin:process.env.STREAM_ORIGIN,streamToken:process.env.STREAM_SERVICE_TOKEN,grantFor:video=>application.playback.internalGrant(video),jobLease:()=>application.playback.metadataLease()}):null;
  if(sync)application.attachSync(sync.state);
  const handler=createAPI({streamOrigin:process.env.STREAM_ORIGIN,streamToken:process.env.STREAM_SERVICE_TOKEN,gatewayToken:process.env.API_GATEWAY_TOKEN,publicOrigin:process.env.PUBLIC_ORIGIN,production,application});
  const server=http.createServer(handler);server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=5000;server.maxHeadersCount=64;
  server.listen(Number(process.env.API_PORT||3000),process.env.API_HOST||(production?'0.0.0.0':'127.0.0.1'),()=>console.log(JSON.stringify({event:'api_started'})));
  let shuttingDown=false;
  const shutdown=()=>{if(shuttingDown)return;shuttingDown=true;console.log(JSON.stringify({event:'api_shutdown'}));const closed=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();const force=setTimeout(()=>server.closeAllConnections(),15000);force.unref();void(async()=>{await sync?.close();await closed;await handler.close();clearTimeout(force);process.exit(0);})();};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{start();}catch(error){console.error(JSON.stringify({event:'api_configuration_error',message:error instanceof ConfigurationError?error.message:'Check server configuration and private key permissions.'}));process.exitCode=1;}}

import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const MiB=1024*1024;
export const thumbnailKey=video=>createHash('sha256').update(JSON.stringify([2,video.id,video.filename,video.sizeBytes,video.uploadedAt])).digest('hex');

// FFmpeg sees only this job-scoped loopback resource. Telegram credentials never
// enter its arguments. Every read is finite, authenticated upstream and budgeted.
export async function openRangeSource(video,{readRange,signal,maxBytes=24*MiB,maxRequests=48,chunkSize=512*1024}){
  const secret=randomBytes(24).toString('hex');
  const stats={bytes:0,requests:0,exhausted:false};
  let pendingRead=Promise.resolve();
  const serializedRead=(start,end,signal)=>{
    const turn=pendingRead.then(()=>{signal.throwIfAborted();return readRange(start,end,signal);});
    pendingRead=turn.catch(()=>{});return turn;
  };
  const server=http.createServer(async(req,res)=>{
    if(req.url!==`/${secret}`||!['GET','HEAD'].includes(req.method)){res.writeHead(404);return res.end();}
    if(signal.aborted){res.writeHead(503);return res.end();}
    const headers={'Accept-Ranges':'bytes','Content-Type':video.mimeType||'application/octet-stream','Cache-Control':'no-store'};
    if(req.method==='HEAD'){res.writeHead(200,{...headers,'Content-Length':video.sizeBytes});return res.end();}
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'bytes=0-');
    const start=match?Number(match[1]):NaN,requestedEnd=match?.[2]?Number(match[2]):video.sizeBytes-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start<0||start>=video.sizeBytes||requestedEnd<start){res.writeHead(416,{'Content-Range':`bytes */${video.sizeBytes}`});return res.end();}
    const end=Math.min(requestedEnd,video.sizeBytes-1);
    const disconnected=new AbortController();res.on('close',()=>disconnected.abort());
    const readSignal=AbortSignal.any([signal,disconnected.signal]);
    try{
      // Advertise the actual requested range. Older FFmpeg versions treat an
      // artificially shortened Content-Range as a premature EOF. Read that range
      // incrementally; seeking/encoder completion cancels outstanding reads.
      for(let position=start;position<=end;){
        if(readSignal.aborted)throw Error('Read cancelled');
        const partEnd=Math.min(end,position+chunkSize-1),length=partEnd-position+1;
        if(stats.requests>=maxRequests||stats.bytes+length>maxBytes){stats.exhausted=true;throw Error('Read budget exhausted');}
        // Reserve before awaiting so concurrent reads cannot overrun the budget.
        stats.requests++;stats.bytes+=length;
        const bytes=await serializedRead(position,partEnd,readSignal);
        if(bytes.length!==length)throw Error('Invalid partial response');
        if(!res.headersSent)res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${video.sizeBytes}`});
        if(!res.write(bytes))await once(res,'drain',{signal:readSignal});
        position=partEnd+1;
      }
      res.end();
    }catch(error){stats.failure=error.code||'range-read-cancelled-or-failed';if(!res.headersSent){res.writeHead(stats.exhausted?503:502);res.end();}else res.destroy();}
  });
  server.headersTimeout=5000;server.requestTimeout=25000;server.maxHeadersCount=16;
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const close=()=>{server.closeAllConnections();server.close();};
  signal.addEventListener('abort',close,{once:true});
  return {url:`http://127.0.0.1:${server.address().port}/${secret}`,stats,close(){signal.removeEventListener('abort',close);close();}};
}

export async function readVideoRange({fetcher,streamOrigin,streamToken,video,start,end,signal,identity,grantFor}){
  const readSignal=AbortSignal.any([signal,AbortSignal.timeout(22000)]);
  let response;
  for(let attempt=0;attempt<4;attempt++){
    response=await fetcher(new URL(`/internal/videos/${encodeURIComponent(video.publicId||video.id)}/stream`,streamOrigin),{
    headers:{Authorization:`Bearer ${streamToken}`,...(grantFor?{'X-Playback-Grant':await grantFor(video)}:{}),Range:`bytes=${start}-${end}`,...(identity?.etag?{'If-Range':identity.etag}:{})},
      signal:readSignal,redirect:'error'
    });
    if(![502,503,504].includes(response.status)||attempt===3)break;
    await response.body?.cancel();await delay(1500,undefined,{signal:readSignal});
  }
  const expected=end-start+1;
  // Refuse servers that ignore Range, so no entire movie is buffered or fetched.
  if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${video.sizeBytes}`||Number(response.headers.get('content-length'))!==expected){await response.body?.cancel();throw Object.assign(Error('Range streaming unavailable'),{code:`invalid-range-response-${response.status}`});}
  if(identity){const etag=response.headers.get('etag');if(!etag||(identity.etag&&identity.etag!==etag)){await response.body?.cancel();throw Error('Video changed during extraction');}identity.etag=etag;}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>expected)throw Error('Range exceeded');chunks.push(Buffer.from(value));}if(size!==expected)throw Error('Incomplete range');return Buffer.concat(chunks,size);}
  finally{await reader.cancel().catch(()=>{});}
}

export function frameArguments(url,seconds){
  return ['-hide_banner','-loglevel','error','-nostdin','-max_alloc',String(128*MiB),
    '-protocol_whitelist','http,tcp','-rw_timeout','22000000','-seekable','1',
    '-short_seek_size','524288','-multiple_requests','1',
    '-probesize',String(2*MiB),'-analyzeduration','3000000','-threads','2',
    '-ss',String(seconds),'-t','8','-i',url,'-map','0:V:0','-an','-sn','-dn',
    '-filter_threads','1','-vf','fps=2,scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2,blackframe=amount=0:threshold=24,metadata=select:key=lavfi.blackframe.pblack:value=90:function=less,signalstats,metadata=select:key=lavfi.signalstats.YAVG:value=235:function=less,entropy,metadata=select:key=lavfi.entropy.normalized_entropy.normal.Y:value=0.15:function=greater,thumbnail=n=8',
    '-frames:v','1','-threads','1','-c:v','mjpeg','-pix_fmt','yuvj420p','-q:v','4','-f','image2pipe','pipe:1'];
}

export function extractFrame(ffmpegPath,url,seconds,signal,onDiagnostic){
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpegPath,frameArguments(url,seconds),{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const chunks=[];let size=0,settled=false,diagnostics='';
    const abort=()=>child.kill('SIGKILL');
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>256*1024)abort();else chunks.push(chunk);});
    // Drain diagnostics without logging file metadata, URLs or private captions.
    child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4096);onDiagnostic?.(chunk.toString());});
    const finish=(error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);const bytes=Buffer.concat(chunks);if(error||signal.aborted||size>256*1024||bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9){const status=/Server returned (\d+)|HTTP error (\d+)/.exec(diagnostics);reject(Object.assign(Error('Frame extraction unavailable'),{code:signal.aborted?'extraction-timeout':status?`source-http-${status[1]||status[2]}`:'decode-or-frame-unavailable'}));}else resolve(bytes);};
    child.once('error',finish);child.once('close',code=>finish(code!==0));
  });
}

export function sampleTimes(duration){
  return Number.isFinite(duration)&&duration>0?[duration*.15,duration*.4,duration*.65].map(n=>Math.round(Math.min(90,n)*100)/100):[90,30,5];
}

export function createThumbnailService({streamOrigin,streamToken,grantFor,fetcher=(...args)=>fetch(...args),ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg',extract=extractFrame,maxCacheBytes=16*MiB,ttl=30*60*1000,maxPending=64,maxBytes=24*MiB,maxRequests=48,jobTimeout=150000,attemptTimeout=45000,logger=event=>console.log(JSON.stringify(event))}){
  const entries=new Map(),queue=[];let running=false,cacheBytes=0,closed=false,active;
  function remove(key){const entry=entries.get(key);if(entry?.bytes)cacheBytes-=entry.bytes.length;entries.delete(key);}
  function prune(){for(const [key,value] of entries)if(value.expires&&value.expires<=Date.now())remove(key);for(const [key,value] of entries){if(cacheBytes<=maxCacheBytes&&entries.size<=256)break;if(value.status!=='pending')remove(key);}}
  async function drain(){
    if(running||closed)return;running=true;
    while(queue.length&&!closed){
      const entry=queue.shift();active=new AbortController();const timeout=setTimeout(()=>active.abort(),jobTimeout);let source,lastFailure;
      try{
        const identity={};
        source=await openRangeSource(entry.video,{signal:active.signal,maxBytes,maxRequests,readRange:(start,end,signal)=>readVideoRange({fetcher,streamOrigin,streamToken,video:entry.video,start,end,signal,identity,grantFor})});
        let bytes;
        for(const seconds of sampleTimes(entry.video.durationSeconds)){
          try{bytes=await extract(ffmpegPath,source.url,seconds,AbortSignal.any([active.signal,AbortSignal.timeout(attemptTimeout)]));break;}
          catch(error){lastFailure=error.code;if(active.signal.aborted||source.stats.exhausted)break;}
        }
        if(!bytes)throw Error('No suitable frame');
        entry.bytes=bytes;cacheBytes+=bytes.length;entry.status='ready';entry.expires=Date.now()+ttl;
      }catch{entry.status='unavailable';entry.expires=Date.now()+5*60*1000;}
      finally{clearTimeout(timeout);active.abort();source?.close();logger({event:'thumbnail_complete',video:entry.video.id,status:entry.status,rangeBytes:source?.stats.bytes||0,rangeRequests:source?.stats.requests||0,...(entry.status==='unavailable'?{reason:source?.stats.failure||lastFailure||'no-frame'}:{})});active=undefined;prune();}
    }
    running=false;
  }
  return {
    get(video,{generate=true}={}){
      prune();const key=thumbnailKey(video);let entry=entries.get(key);
      if(entry){entries.delete(key);entries.set(key,entry);return entry;}
      if(!generate||closed)return {status:'unavailable'};
      if(!Number.isSafeInteger(video.sizeBytes)||video.sizeBytes<=0)return {status:'unavailable'};
      if(queue.length+(running?1:0)>=maxPending)return {status:'busy'};
      entry={status:'pending',video};entries.set(key,entry);queue.push(entry);void drain();return entry;
    },
    close(){closed=true;active?.abort();queue.length=0;entries.clear();cacheBytes=0;}
  };
}

export const SEGMENT_SIZE = 1024*1024;
export function parseRange(header,size) {
  if(!Number.isSafeInteger(size)||size<=0)throw new Error('Unknown size');
  if(!header)return {start:0,end:size-1,partial:false};
  const m=/^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if(!m || (!m[1]&&!m[2]))throw new Error('Invalid range');
  const a=m[1]?Number(m[1]):null,b=m[2]?Number(m[2]):null;
  if((a!==null&&!Number.isSafeInteger(a))||(b!==null&&!Number.isSafeInteger(b)))throw new Error('Invalid range');
  if(a===null){if(b<=0)throw new Error('Invalid suffix');return {start:Math.max(0,size-b),end:size-1,partial:true};}
  if(a>=size||(b!==null&&b<a))throw new Error('Unsatisfiable range');
  return {start:a,end:b===null?size-1:Math.min(b,size-1),partial:true};
}
const abortError=()=>new DOMException('Request canceled','AbortError');
const prohibitsStorage=headers=>/(?:^|,)\s*no-store\s*(?:[=,]|$)/i.test(headers.get('cache-control')||'');
// One shared network operation per segment. Cancel it only when all consumers leave.
export class SharedRequests {
  constructor(){this.pending=new Map();}
  get(key,operation,signal){
    if(signal?.aborted)return Promise.reject(abortError());
    let entry=this.pending.get(key);
    if(!entry){entry={controller:new AbortController(),users:0};entry.promise=Promise.resolve().then(()=>operation(entry.controller.signal)).finally(()=>{if(this.pending.get(key)===entry)this.pending.delete(key);});this.pending.set(key,entry);}
    entry.users++;
    return new Promise((resolve,reject)=>{
      let finished=false;
      const finish=(fn,value)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);entry.users--;if(entry.users===0){entry.controller.abort();if(this.pending.get(key)===entry)this.pending.delete(key);}fn(value);};
      const abort=()=>finish(reject,abortError());
      signal?.addEventListener('abort',abort,{once:true});
      entry.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }
}
export class RangeEngine {
  constructor({store,fetcher=(...args)=>fetch(...args),segmentSize=SEGMENT_SIZE,onError=()=>{}}){this.store=store;this.fetcher=fetcher;this.segmentSize=segmentSize;this.onError=onError;this.shared=new SharedRequests();this.active=0;this.waiters=[];}
  async network(url,options){
    const signal=options.signal;
    if(signal?.aborted)throw abortError();
    if(this.active>=2)await new Promise((resolve,reject)=>{
      const entry={resolve:()=>{signal?.removeEventListener('abort',abort);resolve();}};
      const abort=()=>{this.waiters=this.waiters.filter(x=>x!==entry);reject(abortError());};
      signal?.addEventListener('abort',abort,{once:true});this.waiters.push(entry);
    });else this.active++;
    try {
      if(signal?.aborted)throw abortError();
      const res=await this.fetcher(url,options);
      // Keep the concurrency slot until the bounded part body has been read.
      let bytes=null;
      if(options.method!=='HEAD'){
        const size=Number(res.headers.get('content-length'));
        if(res.status!==206 || !Number.isSafeInteger(size) || size<1 || size>this.segmentSize){await res.body?.cancel();throw new Error('Invalid segment response');}
        const reader=res.body.getReader();const chunks=[];let received=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>size)throw new Error('Oversized segment');chunks.push(value);}}catch(error){await reader.cancel();throw error;}
        const joined=new Uint8Array(received);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}bytes=joined.buffer;
      }
      return {res,bytes};
    }finally{const next=this.waiters.shift();if(next)next.resolve();else this.active--;}
  }
  async part(url,meta,base,signal){
    const end=Math.min(base+this.segmentSize-1,meta.size-1), key=`${url}|${meta.etag}|${base}`;
    return this.shared.get(key,async sharedSignal=>{
      let settings;
      try{settings=await this.store.settings();const cached=settings.enabled?await this.store.get(key):null;if(cached && cached.end===end && cached.data.byteLength===end-base+1)return cached.data;}catch{/* Storage failure must not prevent streaming. */}
      const {res,bytes}=await this.network(url,{headers:{Range:`bytes=${base}-${end}`,'If-Range':meta.etag},cache:'no-store',signal:sharedSignal});
      if(res.status!==206||res.headers.get('content-range')!==`bytes ${base}-${end}/${meta.size}`||res.headers.get('etag')!==meta.etag||bytes.byteLength!==end-base+1)throw new Error('Stream changed or returned an incomplete range');
      if(settings?.enabled&&!prohibitsStorage(res.headers))try{await this.store.put({key,videoId:new URL(url).pathname.split('/')[3],etag:meta.etag,start:base,end,data:bytes},settings.generation);}catch{/* Quota/security failures leave network playback available. */}
      return bytes;
    },signal);
  }
  async respond(request){
    const cancel=new AbortController();const abort=()=>cancel.abort();request.signal?.addEventListener('abort',abort,{once:true});
    const cleanup=()=>request.signal?.removeEventListener('abort',abort);
    if(request.signal?.aborted)cancel.abort();
    let meta;
    try {
      const {res}=await this.shared.get('HEAD:'+request.url,signal=>this.network(request.url,{method:'HEAD',cache:'no-store',signal}),cancel.signal);
      if(!res.ok){cleanup();return this.fetcher(request);}
      // Revalidate policy before reading any previously persisted segment.
      if(prohibitsStorage(res.headers)){cleanup();return this.fetcher(request,{cache:'no-store'});}
      meta={size:Number(res.headers.get('content-length')),type:res.headers.get('content-type')||'application/octet-stream',etag:res.headers.get('etag')};
      if(!meta.etag||meta.etag.startsWith('W/')||!Number.isSafeInteger(meta.size)||meta.size<=0){cleanup();return this.fetcher(request);}
    }catch(error){cleanup();if(cancel.signal.aborted)throw error;return this.fetcher(request);}
    let range;
    try{range=parseRange(request.headers.get('if-range')&&request.headers.get('if-range')!==meta.etag?null:request.headers.get('range'),meta.size);}
    catch{cleanup();return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta.size}`}});}
    let position=range.start;
    const body=new ReadableStream({
      pull:async controller=>{
        try{
          if(cancel.signal.aborted)throw abortError();
          const base=Math.floor(position/this.segmentSize)*this.segmentSize;
          const buffer=await this.part(request.url,meta,base,cancel.signal);
          const count=Math.min(buffer.byteLength-(position-base),range.end-position+1);
          controller.enqueue(new Uint8Array(buffer,position-base,count));position+=count;
          if(position>range.end){controller.close();cleanup();}
        }catch(error){this.onError(error.message);controller.error(error);cleanup();cancel.abort();}
      },cancel(){cleanup();cancel.abort();}
    },{highWaterMark:0});
    const headers={'Content-Type':meta.type,'Content-Length':String(range.end-range.start+1),'Accept-Ranges':'bytes','ETag':meta.etag,'Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin'};
    if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${meta.size}`;
    return new Response(body,{status:range.partial?206:200,headers});
  }
}

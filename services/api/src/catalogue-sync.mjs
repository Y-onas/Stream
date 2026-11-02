import {inspectDuration} from './media-metadata.mjs';
export async function importCatalogue(db,catalogue,now=new Date()){
  if(!Array.isArray(catalogue?.items))throw Error('Invalid catalogue');
  const existing=new Map((await db.video.findMany({select:{id:true,filename:true,sizeBytes:true}})).map(v=>[v.id,v]));
  const operations=[];
  const valid=catalogue.items.filter(item=>typeof item?.id==='string'&&/^[\w-]+$/.test(item.id)&&typeof item.filename==='string'&&Number.isSafeInteger(item.sizeBytes)&&item.sizeBytes>0&&Number.isFinite(Date.parse(item.uploadedAt)));
  if(valid.length!==catalogue.items.length)console.log(JSON.stringify({event:'catalogue_items_skipped',count:catalogue.items.length-valid.length}));
  for(const item of valid){
    const source=/^(channel|group)-(\d+)-(\d+)$/.exec(item.id),old=existing.get(item.id),changed=old&&(old.filename!==item.filename||old.sizeBytes!==BigInt(item.sizeBytes));
    const known=Number.isFinite(item.durationSeconds)&&item.durationSeconds>0;
    const data={title:String(item.title),titleUnverified:item.titleUnverified!==false,description:item.description||'',filename:item.filename,mimeType:item.mimeType||'application/octet-stream',sizeBytes:BigInt(item.sizeBytes),uploadedAt:new Date(item.uploadedAt),artwork:item.artwork||null,available:true,lastSyncedAt:now,...(source?{telegramKind:source[1],telegramSourceId:source[2],telegramMessageId:Number(source[3])}:{}),...(known?{durationSeconds:item.durationSeconds,durationSource:'telegram'}:changed?{durationSeconds:null,durationSource:null,inspectionAttemptedAt:null}:{})};
    operations.push(db.video.upsert({where:{id:item.id},create:{id:item.id,...data},update:data}));
  }
  for(let offset=0;offset<operations.length;offset+=50)await db.$transaction(operations.slice(offset,offset+50));
  if(catalogue.sync?.initialComplete)await db.video.updateMany({where:{id:{notIn:valid.map(v=>v.id)},available:true},data:{available:false}});
  return valid.length;
}
export function startCatalogueSync({db,streamOrigin,streamToken,fetcher=fetch,interval=15000,inspect=inspectDuration}){
  const abort=new AbortController();let syncing=false,inspecting=false,closed=false,timer,inspectionWork=Promise.resolve(),syncWork=Promise.resolve();
  const state={ready:false,lastSuccess:null,error:null,source:null};
  async function durations(){
    if(inspecting||closed)return;inspecting=true;
    try{
      const rows=await db.video.findMany({where:{available:true,durationSeconds:null,OR:[{inspectionAttemptedAt:null},{inspectionAttemptedAt:{lt:new Date(Date.now()-30*60000)}}]},orderBy:{uploadedAt:'desc'},take:10});
      for(const row of rows){if(closed)break;await db.video.update({where:{id:row.id},data:{inspectionAttemptedAt:new Date()}});try{const seconds=await inspect({...row,sizeBytes:Number(row.sizeBytes)},{streamOrigin,streamToken,fetcher,signal:abort.signal});if(!closed){await db.video.update({where:{id:row.id},data:{durationSeconds:seconds,durationSource:'ffmpeg'}});console.log(JSON.stringify({event:'video_duration_measured',video:row.id,seconds}));}}catch{if(!closed)console.log(JSON.stringify({event:'video_duration_unavailable',video:row.id}));}}
    }finally{inspecting=false;}
  }
  async function cycle(){
    if(syncing||closed)return;syncing=true;
    try{
      const response=await fetcher(new URL('/internal/catalogue',streamOrigin),{headers:{Authorization:`Bearer ${streamToken}`},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});if(!response.ok)throw Error();
      const catalogue=await response.json(),count=await importCatalogue(db,catalogue);state.ready=true;state.lastSuccess=new Date();state.error=null;state.source=catalogue.sync||null;console.log(JSON.stringify({event:'database_catalogue_synced',videos:count}));
      if(!inspecting)inspectionWork=durations().catch(()=>console.log(JSON.stringify({event:'duration_inspection_failed'})));
    }catch{state.error='Catalogue synchronization is temporarily unavailable';console.log(JSON.stringify({event:'database_catalogue_sync_failed'}));}finally{syncing=false;}
  }
  syncWork=cycle();timer=setInterval(()=>{syncWork=cycle();},interval);timer.unref();
  return {state,initial:syncWork,async close(){closed=true;clearInterval(timer);abort.abort();await Promise.allSettled([syncWork,inspectionWork]);}};
}

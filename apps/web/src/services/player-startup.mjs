// Repeated renders and StrictMode effect replays must not restart a paused video.
// A new element (Retry) or authorized source gets exactly one automatic attempt.
export function createPlaybackStarter(){
 let attempt;
 return (element,source,start)=>{
  if(!element||!source)return Promise.resolve();
  if(attempt?.element===element&&attempt.source===source)return attempt.promise;
  attempt={element,source};
  try{attempt.promise=Promise.resolve(start());}catch(error){attempt.promise=Promise.reject(error);}
  return attempt.promise;
 };
}

// This is the optional Resume destination, not the automatic startup position.
// Preparing progress must never start a second media request or change playback.
export function startupPosition({local,account,authorized=0}={}){
 if(Number.isFinite(authorized)&&authorized>1)return authorized;
 const progress=account||local;
 return progress&&!progress.completed&&Number.isFinite(progress.position)&&progress.position>1?progress.position:0;
}

// Start this window on the first actual playing event, not during authorization
// or initial buffering. Further playing events must not extend the suggestion.
export function createResumeWindow(expire,{schedule=setTimeout,cancel=clearTimeout}={}){
 let timer,started=false,closed=false;
 return {
  start(){if(started||closed)return;started=true;timer=schedule(()=>{if(!closed)expire();},20000);},
  close(){closed=true;cancel(timer);}
 };
}

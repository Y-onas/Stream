// One video page per browser tab. Wait for a departed page's release before
// authorizing its replacement, including when the old authorization arrives late.
let closing=Promise.resolve();
export function createPlaybackLifecycle({authorize,terminate}){
 let closed=false,release,session;
 const ready=closing.then(()=>closed?null:authorize()).then(value=>{session=value;return value;});
 function close(){
  if(closed)return release;
  closed=true;
  // Start keepalive fetch synchronously during pagehide when the session is
  // known; a departing document may not run another promise continuation.
  let result;try{result=session?terminate(session):ready.then(value=>value?terminate(value):undefined);}catch{result=Promise.reject();}
  release=Promise.resolve(result).then(()=>true,()=>false);
  closing=Promise.all([closing,release]).then(()=>undefined);
  return release;
 }
 return {ready,close};
}

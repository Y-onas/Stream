let csrfToken=null;
export async function api(path,options={}) {
  const {json,...request}=options;
  const response=await fetch(`/api${path}`,{credentials:'same-origin',...request,...(json!==undefined?{body:JSON.stringify(json)}:{}),headers:{'Accept':'application/json',...(json!==undefined?{'Content-Type':'application/json'}:{}),...(csrfToken?{'X-CSRF-Token':csrfToken}:{}),...options.headers}});
  const data=await response.json();
  if(Object.hasOwn(data,'csrfToken'))csrfToken=data.csrfToken;
  if(!response.ok && response.status!==501)throw Object.assign(new Error(data.message || 'Something went wrong. Please try again.'),{status:response.status,code:data.code});
  return data;
}
export const streamUrl=id=>`/api/videos/${encodeURIComponent(id)}/stream`;
export async function startCache(){
  if(!('serviceWorker' in navigator))return false;
  try {await navigator.serviceWorker.register('/sw.js',{type:'module',scope:'/'});await navigator.serviceWorker.ready;return true;}catch{return false;}
}
export async function cacheMessage(options){
  if(!navigator.serviceWorker?.controller)return {ok:false,message:'Device caching is not active. Playback still works.'};
  return new Promise(resolve=>{
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve({ok:false,message:'Device storage did not respond.'});},5000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
    navigator.serviceWorker.controller.postMessage({type:options?'CACHE_CONFIG':'CACHE_STATUS',options},[channel.port2]);
  });
}

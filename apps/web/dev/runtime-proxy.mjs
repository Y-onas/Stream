import http from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
const configURL=new URL('../../../.local/runtime.json',import.meta.url);
export function runtimeProxy({origin='http://127.0.0.1:5173'}={}){
  return (req,res,next)=>{
    if(!req.url.startsWith('/api/'))return next();
    let options={};try{if(existsSync(configURL))options=JSON.parse(readFileSync(configURL,'utf8'));}catch{res.writeHead(503);return res.end();}
    const target=process.env.APPLICATION_API_ORIGIN||options.apiOrigin||'http://127.0.0.1:3000';
    const token=process.env.API_GATEWAY_TOKEN||options.gatewayToken||'';
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);return res.end();}
    const headers={host:new URL(target).host,'x-gateway-token':token,'x-client-ip':req.socket.remoteAddress};for(const key of ['range','if-range','if-match','content-type','content-length','origin','sec-fetch-site','cookie','authorization','x-csrf-token'])if(req.headers[key])headers[key]=req.headers[key];
    const upstream=http.request(new URL(req.url,target),{method:req.method,headers},incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.on('error',()=>res.destroy());incoming.pipe(res);res.on('close',()=>incoming.destroy());});
    upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message:'Application API is unavailable. Start the managed runtime.'}));}else res.destroy();});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
  };
}

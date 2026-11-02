import {readFile} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import {runtimeProxy} from './runtime-proxy.mjs';

const catalogueFile = fileURLToPath(new URL('../../../.local/catalogue.json', import.meta.url));
// Deliberately server-side. Never load the repository .env into Vite.
const upstream = 'http://127.0.0.1:8080';
const webOrigin = 'http://127.0.0.1:5173';
const unavailable = feature => ({available: false, code: 'NOT_IMPLEMENTED', message: `${feature} is not available yet.`, items: []});
const json = (res, status, data) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data));};
export function publicVideo(v) {
  return {id:v.id, title:v.title, titleUnverified:!!v.titleUnverified, description:v.description || '', filename:v.filename, mimeType:v.mimeType || '', sizeBytes:v.sizeBytes, uploadedAt:v.uploadedAt, durationSeconds:v.durationSeconds ?? null, artwork:v.artwork ? `/api/videos/${encodeURIComponent(v.id)}/artwork` : null};
}
export async function readCatalogue() {
  try {
    const data = JSON.parse(await readFile(catalogueFile, 'utf8'));
    if (!Array.isArray(data.videos)) throw new Error('Invalid local catalogue');
    return data.videos.filter(v => /^[a-zA-Z0-9_-]+$/.test(v.id) && typeof v.title === 'string' && Number.isSafeInteger(v.messageId) && v.messageId > 0 && Number.isSafeInteger(v.sizeBytes) && v.sizeBytes > 0);
  } catch (e) { if(e.code === 'ENOENT') return []; throw e; }
}
export function createAdapter({load = readCatalogue, origin = webOrigin, target = upstream} = {}) {
  return async function adapter(req, res, next) {
    // Apply to all routes, including source assets, to reject browser cross-origin access.
    if(req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{message:'Local same-origin requests only.'});
    const url = new URL(req.url, origin);
    if(req.method==='GET' && ['/sw.js','/cache/storage.mjs','/cache/engine.mjs'].includes(url.pathname)){
      // Serve worker modules verbatim: Vite must not rewrite imports in this separate runtime.
      try{const source=await readFile(new URL('../public'+url.pathname,import.meta.url));res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-cache','Service-Worker-Allowed':'/'});return res.end(source);}catch{return json(res,404,{message:'Worker asset unavailable.'});}
    }
    if(!url.pathname.startsWith('/api/')) return next();
    if(req.headers['content-length'] > 0 || req.headers['transfer-encoding']) return json(res,400,{message:'Request bodies are not supported by the local adapter.'});
    if(!['GET','HEAD'].includes(req.method)) return json(res,501,{message:'This action awaits the application API.'});
    try {
      if(url.pathname === '/api/trending') return json(res,501,unavailable('Trending'));
      if(url.pathname === '/api/videos' && url.searchParams.get('sort') === 'most-viewed') return json(res,501,unavailable('Most viewed'));
      const videos = await load();
      if(url.pathname === '/api/videos') return json(res,200,{items:videos.map(publicVideo), capabilities:{viewRanking:false,comments:false}, source:'local-manual-selection'});
      const route = /^\/api\/videos\/([\w-]+)(?:\/(stream|comments|artwork))?$/.exec(url.pathname);
      const video = route && videos.find(v => v.id === route[1]);
      if(!video) return json(res,404,{message:'Video not found.'});
      if(route[2] === 'comments') return json(res,501,unavailable('Comments'));
      if(route[2] === 'artwork') {
        // Only a basename selected by the local operator, never an HTTP-supplied path.
        if(!video.artwork || !/^[\w-]+\.(jpg|png|webp)$/.test(video.artwork)) return json(res,404,{message:'Artwork unavailable.'});
        const bytes = await readFile(new URL('../../../.local/'+video.artwork, import.meta.url));
        res.writeHead(200,{'Content-Type':video.artwork.endsWith('.png')?'image/png':video.artwork.endsWith('.webp')?'image/webp':'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      if(!route[2]) return json(res,200,publicVideo(video));
      if(url.search) return json(res,400,{message:'Stream query parameters are not supported.'});
      const headers = {};
      for(const key of ['range','if-range','if-match']) if(req.headers[key]) headers[key]=req.headers[key];
      // Construct the private path only from operator-selected metadata. No peer IDs or access hashes accepted.
      const upstreamReq = httpRequest(`${target}/media/stream/${video.messageId}`,{method:req.method,headers}, upstreamRes => {
        const output = {};
        for(const key of ['content-type','content-length','content-range','accept-ranges','etag','retry-after']) if(upstreamRes.headers[key]) output[key]=upstreamRes.headers[key];
        res.writeHead(upstreamRes.statusCode, {...output,'Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin','X-Content-Type-Options':'nosniff'});
        upstreamRes.on('error', () => res.destroy());
        upstreamRes.pipe(res);
        res.on('close', () => {upstreamRes.destroy(); upstreamReq.destroy();});
      });
      upstreamReq.on('error', () => {if(!res.headersSent) json(res,502,{message:'Video streaming is unavailable. Please try again later.'}); else res.destroy();});
      upstreamReq.setTimeout(30000, () => upstreamReq.destroy());
      req.on('aborted',()=>upstreamReq.destroy());
      res.on('close',()=>upstreamReq.destroy());
      upstreamReq.end();
    } catch {if(!res.headersSent) json(res,503,{message:'The local catalogue is unavailable.'}); else res.destroy();}
  };
}
export function localAdapter() {
  // The manual adapter remains available to its isolated regression fixtures.
  // Runtime traffic always uses the real application API, never the local JSON list.
  return {name:'habeshan-api-proxy', configureServer(server){server.middlewares.use(runtimeProxy());server.middlewares.use(createAdapter());}, configurePreviewServer(server){server.middlewares.use(runtimeProxy());server.middlewares.use(createAdapter());}};
}

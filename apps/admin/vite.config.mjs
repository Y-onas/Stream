import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {runtimeProxy} from '../web/dev/runtime-proxy.mjs';
const apiProxy={name:'admin-api-proxy',configureServer(server){server.middlewares.use(runtimeProxy({origin:'http://127.0.0.1:5174'}));},configurePreviewServer(server){server.middlewares.use(runtimeProxy({origin:'http://127.0.0.1:5174'}));}};
const routeMiddleware=server=>{server.middlewares.use((req,res,next)=>{
 const pathname=new URL(req.url,'http://admin.local').pathname;
 if(pathname==='/'||pathname==='/admin'||pathname.startsWith('/admin/')){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found.');return;}
 res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');next();
});};
const routeHeaders={name:'admin-route-headers',configureServer:routeMiddleware,configurePreviewServer:routeMiddleware};
export default defineConfig({base:process.env.ADMIN_BASE||'/hub-console/',plugins:[react(),routeHeaders,apiProxy],envDir:false,server:{host:'127.0.0.1',port:5174,strictPort:true,cors:false,fs:{strict:true,allow:['src','../../node_modules'],deny:['**/.env*','**/.sessions/**','**/.local/**','**/services/**']}},preview:{host:'127.0.0.1',port:5174,strictPort:true,cors:false}});

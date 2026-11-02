import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {runtimeProxy} from '../web/dev/runtime-proxy.mjs';
const apiProxy={name:'admin-api-proxy',configureServer(server){server.middlewares.use(runtimeProxy({origin:'http://127.0.0.1:5174'}));},configurePreviewServer(server){server.middlewares.use(runtimeProxy({origin:'http://127.0.0.1:5174'}));}};
export default defineConfig({base:process.env.ADMIN_BASE||'/',plugins:[react(),apiProxy],envDir:false,server:{host:'127.0.0.1',port:5174,strictPort:true,cors:false,fs:{strict:true,allow:['src','../../node_modules'],deny:['**/.env*','**/.sessions/**','**/.local/**','**/services/**']}},preview:{host:'127.0.0.1',port:5174,strictPort:true,cors:false}});

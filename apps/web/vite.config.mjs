import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {localAdapter} from './dev/adapter.mjs';
export default defineConfig({
  plugins: [react(), localAdapter()],
  envDir: false,
  server: {host: '127.0.0.1', port: 5173, strictPort: true, cors: false, fs: {strict: true, allow: ['src','public','qa','qa.html','../../node_modules'], deny: ['**/.env*','**/.sessions/**','**/.local/**','**/services/**','**/.git/**']}},
  preview: {host: '127.0.0.1', port: 5173, strictPort: true, cors: false}
});

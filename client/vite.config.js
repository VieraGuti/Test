import { defineConfig } from 'vite';
export default defineConfig({server:{port:5173,host:true,proxy:{'/':{target:'ws://localhost:3000',ws:true}}}});

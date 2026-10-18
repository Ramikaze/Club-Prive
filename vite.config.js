import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the interface with hot reload; /api goes to `npm run dev:api` (wrangler dev).
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
});

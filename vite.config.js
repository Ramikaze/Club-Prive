import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Each build gets its own name (the time it was made), written into the page (<meta name="club-build">) and next to it
// in dist/version.json. A page left open compares the two to learn that a new version was put online
// (src/lib/update.js, UpdateNotice.jsx).
function clubVersion() {
  const build = new Date().toISOString();
  return {
    name: 'club-version',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'club-build', content: build }, injectTo: 'head' }],
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build })}\n` });
    },
  };
}

// `npm run dev` serves the interface with hot reload; /api goes to `npm run dev:api` (wrangler dev).
export default defineConfig({
  plugins: [react(), clubVersion()],
  base: '/',
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
});

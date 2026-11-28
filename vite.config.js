import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend source lives in web/. `npm run build` writes the finished site into public/,
// which the server serves as-is, so the server needs no build tools.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/media': 'http://127.0.0.1:3000' } },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/app[extname]' } },
  },
});

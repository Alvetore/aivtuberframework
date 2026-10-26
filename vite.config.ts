import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: 'src/renderer',
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true }, '/ws': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: true } } },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});

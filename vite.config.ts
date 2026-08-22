import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ironslide/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  },
  server: { port: 5173 }
});

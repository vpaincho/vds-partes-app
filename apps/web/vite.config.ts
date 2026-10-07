import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static bundle, no SSR. 18_TECHNICAL_ADR: there is no existing Next app to preserve and no
 * SEO/SSR requirement, so a static build keeps the deployment decision open (W7).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 4173,
    host: '127.0.0.1',
    proxy: {
      // The API runs separately; proxying keeps the browser on one origin in development.
      '/api': { target: 'http://127.0.0.1:4180', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});

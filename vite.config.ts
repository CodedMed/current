import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = process.env.PORT ?? '3000';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Everything under /api is served by the Express backend. Proxying keeps the
    // browser on a single origin, so the session cookie and OAuth redirects work
    // identically in development and production.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
});

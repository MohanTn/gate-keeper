import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/viz/',
  server: {
    port: 5380,
    proxy: {
      '/api': 'http://localhost:5378',
      '/ws': { target: 'ws://localhost:5378', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

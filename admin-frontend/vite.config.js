import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  base: './',

  plugins: [react(), tailwindcss()],

  define: {
    global: 'globalThis',
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5174,
    // Never watch the packaged-installer output: electron:build rewrites it
    // while the dev server runs, which crashes Vite's file watcher (EBUSY).
    watch: {
      ignored: ['**/dist-electron-build/**', '**/dist-electron/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8085',
        changeOrigin: true,
      },
    },
  },
});
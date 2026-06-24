import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        // TODO: update the target: url to env variable from .env file
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
    },
  },
});

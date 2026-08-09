import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // Bundle the workspace package into the main bundle; keep native/runtime deps external.
    plugins: [externalizeDepsPlugin({ exclude: ['@opstally/tally-client'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});

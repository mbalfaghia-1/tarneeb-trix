import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  // Our workspace packages are TypeScript source (exports → ./src). Keep them OUT of
  // Vite's dependency pre-bundle so edits to the engine/AI hot-reload immediately
  // instead of serving a stale bundle until the dev server is restarted.
  optimizeDeps: { exclude: ['@tarneeb/ai', '@tarneeb/engine'] },
});

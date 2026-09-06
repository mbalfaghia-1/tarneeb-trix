import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// A human-readable build stamp shown in the app, so a tester can confirm at a glance
// which build their device actually loaded (cache/service-worker issues otherwise hide it).
const BUILD_STAMP = new Date()
  .toISOString()
  .slice(0, 16)
  .replace('T', ' '); // e.g. "2026-09-06 14:12"

export default defineConfig({
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // always serve the latest build; no update prompt
      includeAssets: ['icon.svg', 'favicon-48.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tarneeb & Trix',
        short_name: 'Trix',
        description: 'Play Tarneeb, Trix, and Trix Complex against smart bots. Works offline.',
        lang: 'en',
        dir: 'auto',
        theme_color: '#143526',
        background_color: '#143526',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, host: true },
  // Our workspace packages are TypeScript source (exports → ./src). Keep them OUT of
  // Vite's dependency pre-bundle so edits to the engine/AI hot-reload immediately
  // instead of serving a stale bundle until the dev server is restarted.
  optimizeDeps: { exclude: ['@tarneeb/ai', '@tarneeb/engine', '@tarneeb/room'] },
});

import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/web',
  base: '/',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/web/index.html'),
        login: resolve(__dirname, 'src/web/login.html'),
      },
    },
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      strategies: 'generateSW',
      manifest: {
        name: 'Frio Cold-Room Dashboard',
        short_name: 'Frio',
        description: 'Live cold-room temperature dashboard',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/login/],
      },
    }),
  ],
});

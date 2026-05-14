import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallbackDenylist: [/^\/llmapi/],
      },
      manifest: {
        name: 'YEAP',
        short_name: 'YEAP',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api/orch': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api\/orch/, ''),
      },
      '/api/rem': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/api\/rem/, ''),
      },
    },
  },
})

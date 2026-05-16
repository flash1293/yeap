import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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

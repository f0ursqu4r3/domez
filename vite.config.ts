import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages serves the app under /domez/ — the deploy workflow sets
  // DEPLOY_BASE; local dev and plain builds stay at the root.
  base: process.env.DEPLOY_BASE ?? '/',
  plugins: [vue(), tailwindcss()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

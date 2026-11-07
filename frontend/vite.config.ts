/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import type { Plugin, ProxyOptions } from 'vite'

const DJANGO = process.env.DJANGO_URL || 'http://127.0.0.1:8000'
const PORT = Number(process.env.VITE_PORT || 5173)
const outDir = fileURLToPath(new URL('../static_files/static/app/', import.meta.url))

// Django owns the API, admin, feeds, media and signed photo files; every other path is the app
// (Comptech/spa.py does the same in production). The dev server rewrites Origin/Referer so Django's
// CSRF origin check accepts unsafe requests made through the proxy; cookies pass through.
const toDjango: ProxyOptions = {
  target: DJANGO,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (req) => {
      if (req.getHeader('origin')) req.setHeader('origin', DJANGO)
      const ref = req.getHeader('referer')
      if (typeof ref === 'string') req.setHeader('referer', ref.replace(/^https?:\/\/[^/]+/, DJANGO))
    })
  },
}

// Page URLs (anything not proxied and not a Vite or /static/app/ file) get the app's index.html.
function spaFallback(): Plugin {
  const own = /^\/(?:static\/app\/|@|src\/|node_modules\/|__)/
  return {
    name: 'nilaya-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method === 'GET' && !own.test(req.url ?? '') && req.headers.accept?.includes('text/html')) req.url = '/static/app/index.html'
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/static/app/',
  plugins: [react(), spaFallback()],
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: PORT,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': toDjango,
      '/admin': toDjango,
      '/feeds': toDjango,
      '/media': toDjango,
      '/private': toDjango,
      '/photo_cdn': toDjango,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})

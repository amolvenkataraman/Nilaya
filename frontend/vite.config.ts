/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { Plugin, ProxyOptions } from 'vite'

const DJANGO = process.env.DJANGO_URL || 'http://127.0.0.1:8000'
const PORT = Number(process.env.VITE_PORT || 5173)
const outDir = fileURLToPath(new URL('../static_files/static/app/', import.meta.url))

// Everything except the app itself is Django: the API, login pages, media and the shared
// static files (theme.css/theme.js). The dev server rewrites Origin/Referer so Django's
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

// The build must be self-contained under /static/app/ (it is copied to servers by hand), so the
// shared pre-paint theme script and favicon from the classic UI are copied into it rather than
// linked from /static/js or /static/images. theme.css is bundled by the CSS @import.
const SHARED: Record<string, string> = {
  'theme.js': '../static_files/static/js/theme.js',
  'favicon.ico': '../static_files/static/images/favicon.ico',
}
function sharedFiles(): Plugin {
  const read = (name: string) => readFileSync(fileURLToPath(new URL(SHARED[name], import.meta.url)))
  return {
    name: 'avnet-shared-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // /app/... in the browser is the SPA (Django does the same in production via Comptech/spa.py).
        if (/^\/app(\/|\?|$)/.test(req.url ?? '')) req.url = '/static/app/index.html'
        if (req.url === '/') return res.writeHead(302, { Location: '/app/' }).end() // Django's post-login redirect
        const path = req.url?.split('?')[0] ?? ''
        const name = path.startsWith('/static/app/') ? path.slice(path.lastIndexOf('/') + 1) : ''
        if (!Object.hasOwn(SHARED, name)) return next()
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'image/x-icon')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of Object.keys(SHARED)) this.emitFile({ type: 'asset', fileName: name, source: read(name) })
    },
  }
}

export default defineConfig({
  base: '/static/app/',
  plugins: [react(), sharedFiles()],
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
      '/accounts': toDjango,
      '/media': toDjango,
      '/private': toDjango,
      '/photo_cdn': toDjango,
      '^/static/(?!app/)': toDjango,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})

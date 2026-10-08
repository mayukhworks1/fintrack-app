import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Dev proxy target is overridable via VITE_PROXY_TARGET (set in a gitignored
  // .env.local) so the dev server can point at a remote backend without browser
  // CORS — requests are proxied server-side. Defaults to the local backend.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8000'
  // index.html carries <link rel="preconnect" href="%VITE_API_URL%">. Vite only
  // substitutes %VITE_*% for variables that are set; unset, the literal is
  // emitted and the browser gets an invalid preconnect. Production sets this
  // in the deploy workflow; this default covers local and ad-hoc builds so the
  // hint always names a real origin.
  process.env.VITE_API_URL ||= env.VITE_API_URL || 'https://mayukhj24-fintrack-api.hf.space'
  return {
  test: {
    // happy-dom is ESM-native; jsdom causes ERR_REQUIRE_ESM via html-encoding-sniffer
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // Exclude node_modules from transformation except packages that need it
    server: { deps: { inline: ['@testing-library/jest-dom'] } },
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: true,
        // Disable response buffering so SSE streams (/api/status/stream) flow immediately
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const ct = proxyRes.headers['content-type'] || ''
            if (ct.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
    },
  },
  build: {
    // Emits dist/.vite/manifest.json: for each chunk, which chunks it imports
    // statically vs dynamically. That is the only trustworthy answer to "what
    // actually downloads on first paint" — grepping source for import lines
    // cannot see edges Rollup creates while assigning manualChunks.
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React — every user
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/scheduler/')) return 'react-vendor'
          // recharts and d3 are deliberately NOT named here. Naming them put
          // ~115 KB (gz) of charting on every first paint: a manual chunk that
          // shares a dependency with the entry (recharts needs react, which
          // lives in react-vendor) is made a *static* import of the entry so
          // Rollup can guarantee load order, and Vite then modulepreloads it —
          // even though every importer (Analytics, AIAssistant, Studio, the
          // Dashboard's deferred insight blocks) is behind a lazy route.
          // Left unnamed, Rollup still shares one recharts chunk between those
          // pages, but reaches it only via dynamic import, which is never
          // preloaded. Same caching, no cost on first paint.
          // Icons — large but shared across pages
          if (id.includes('node_modules/lucide-react')) return 'icons'
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  }
})

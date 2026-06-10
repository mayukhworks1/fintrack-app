import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Dev proxy target is overridable via VITE_PROXY_TARGET (set in a gitignored
  // .env.local) so the dev server can point at a remote backend without browser
  // CORS — requests are proxied server-side. Defaults to the local backend.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8000'
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React — every user
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/scheduler/')) return 'react-vendor'
          // Split recharts from its d3 deps so each is cacheable independently
          if (id.includes('node_modules/d3-'))      return 'charts-d3'
          if (id.includes('node_modules/recharts')) return 'charts-recharts'
          // Icons — large but shared across pages
          if (id.includes('node_modules/lucide-react')) return 'icons'
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  }
})

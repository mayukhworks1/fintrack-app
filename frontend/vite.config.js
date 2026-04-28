import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split heavy 3rd-party libs into their own chunks so the app shell stays small
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'icons':        ['lucide-react'],
          'charts':       ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})

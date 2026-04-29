import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev mode, proxy /api/* requests to the Tauri HTTP server.
// In production, the Rust server serves both static files and /api/*.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:52341'
    }
  },
  build: {
    outDir: 'dist'
  }
})

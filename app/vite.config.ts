import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    JAN_API_BASE_URL: JSON.stringify(
      process.env.JAN_API_BASE_URL || 'https://api-dev.jan.ai/'
    ),
  },
})

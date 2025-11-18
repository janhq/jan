import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'JanExtensionsWeb',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: ['@janhq/core', 'zustand', 'react', 'react-dom', 'react/jsx-runtime', '@tabler/icons-react']
    },
    emptyOutDir: false // Don't clean the output directory
  },
  define: {
    JAN_BASE_URL: JSON.stringify('https://api-gateway-dev.jan.ai'), // Production server
    // JAN_BASE_URL: JSON.stringify('http://localhost:8000'), // For local dev with jan-api-gateway
  }
})

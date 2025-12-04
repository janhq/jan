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
    emptyOutDir: false // Don't clean this output directory
  },
  define: {
    JAN_BASE_URL: JSON.stringify(process.env.JAN_BASE_URL || 'http://localhost:8000'),
    ENVIRONMENT: JSON.stringify(process.env.ENVIRONMENT || 'prod'),

  }
})

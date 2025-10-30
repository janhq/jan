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
    MENLO_PLATFORM_BASE_URL: JSON.stringify(process.env.MENLO_PLATFORM_BASE_URL || 'https://api-dev.menlo.ai/v1'),
  }
})

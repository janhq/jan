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
      external: ['@janhq/core'],
      output: {
        globals: {
          '@janhq/core': 'JanCore'
        }
      }
    },
    emptyOutDir: false // Don't clean the output directory
  }
})
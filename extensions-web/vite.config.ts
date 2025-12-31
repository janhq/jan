import { defineConfig } from 'vite'

// Default browser extension ID - can be overridden via environment variable
const DEFAULT_BROWSER_EXTENSION_ID = 'mkciifcjehgnpaigoiaakdgabbpfppal'

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
    JAN_BASE_URL: JSON.stringify(process.env.JAN_BASE_URL || 'https://api.jan.ai'),
    ENVIRONMENT: JSON.stringify(process.env.ENVIRONMENT || 'prod'),
    BROWSER_EXTENSION_ID: JSON.stringify(process.env.BROWSER_EXTENSION_ID || DEFAULT_BROWSER_EXTENSION_ID),
    CHROME_STORE_URL: JSON.stringify(process.env.CHROME_STORE_URL || `https://chromewebstore.google.com/detail/jan-browser-mcp/${DEFAULT_BROWSER_EXTENSION_ID}`),
  }
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    IS_TAURI: JSON.stringify('false'),
    IS_MACOS: JSON.stringify('false'),
    IS_WINDOWS: JSON.stringify('false'),
    IS_LINUX: JSON.stringify('false'),
    IS_IOS: JSON.stringify('false'),
    IS_ANDROID: JSON.stringify('false'),
    PLATFORM: JSON.stringify('web'),
    VERSION: JSON.stringify('test'),
    POSTHOG_KEY: JSON.stringify(''),
    POSTHOG_HOST: JSON.stringify(''),
  },
})
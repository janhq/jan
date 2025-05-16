import { defineConfig } from "vite"
export default defineConfig(({ mode }) => ({
  define: process.env.VITEST ? {} : { global: 'window' },
  test: {
    environment: 'jsdom',
  },
}))


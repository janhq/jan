import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
  },
  platform: 'browser',
  define: {
    API_URL: JSON.stringify(`http://127.0.0.1:${process.env.CORTEX_API_PORT ?? "39291"}`),
  },
})

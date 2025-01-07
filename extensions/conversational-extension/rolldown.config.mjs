import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
  },
  platform: 'browser',
  define: {
    API_URL: JSON.stringify('http://127.0.0.1:39291'),
    SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
  },
})

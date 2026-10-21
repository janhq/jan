import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
    sourcemap: true,
  },
  platform: 'browser',
  external: ['@janhq/core'],
})

import { defineConfig } from 'rolldown'

export default defineConfig([
  {
    input: 'index.ts',
    output: {
      format: 'cjs',
      file: 'dist/index.js',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts'],
    },
    platform: 'node',
  },
])

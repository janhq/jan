import { defineConfig } from 'rolldown'
import pkgJson from './package.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    platform: 'browser',
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      VERSION: JSON.stringify(pkgJson.version),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node', 'path', 'hnswlib-node'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.js',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts'],
    },
    define: {
      CORTEX_API_URL: JSON.stringify(`http://127.0.0.1:${process.env.CORTEX_API_PORT ?? "39291"}`),
    },
    platform: 'node',
  },
])

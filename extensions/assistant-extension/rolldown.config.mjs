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
    platform: 'node',
  },
])

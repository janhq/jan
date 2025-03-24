import { defineConfig } from 'rolldown'
import pkgJson from './package.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
      sourcemap: true,
    },
    platform: 'browser',
    external: ['path'],
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      VERSION: JSON.stringify(pkgJson.version),
    },
  },
  {
    input: 'src/node/index.ts',
    external: [
      'fs/promises',
      'path',
      'pacote',
      '@types/pacote',
      '@npmcli/arborist',
      'ulidx',
      'fs',
      'request',
      'crypto',
      'url',
      'http',
      'os',
      'util',
      'child_process',
      'electron',
      'request-progress',
    ],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts'],
    },
    platform: 'node',
  },
])

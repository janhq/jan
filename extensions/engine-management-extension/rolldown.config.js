import { defineConfig } from 'rolldown'
import replace from '@rollup/plugin-replace'
import pkgJson from './package.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    plugins: [
      replace({
        NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
        API_URL: JSON.stringify('http://127.0.0.1:39291'),
        SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
        CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.42'),
      }),
    ],
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
    },
    plugins: [
      replace({
        CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.42'),
      }),
    ],
  },
  {
    input: 'src/node/cpuInfo.ts',
    output: {
      format: 'cjs',
      file: 'dist/node/cpuInfo.js',
    },
    external: ['cpu-instructions'],
    resolve: {
      extensions: ['.ts', '.js', '.svg'],
    },
  },
])

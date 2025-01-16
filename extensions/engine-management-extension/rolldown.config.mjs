import { defineConfig } from 'rolldown'
import { engines, models } from './engines.mjs'
import pkgJson from './package.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      API_URL: JSON.stringify('http://127.0.0.1:39291'),
      SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.46'),
      DEFAULT_REMOTE_ENGINES: JSON.stringify(engines),
      DEFAULT_REMOTE_MODELS: JSON.stringify(models),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
    },
    define: {
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.46'),
    },
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

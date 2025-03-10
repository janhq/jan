import { defineConfig } from 'rolldown'
import packageJson from './package.json' with { type: 'json' }
import defaultSettingJson from './resources/default_settings.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
    },
    platform: 'browser',
    define: {
      NODE: JSON.stringify(`${packageJson.name}/${packageJson.node}`),
      SETTINGS: JSON.stringify(defaultSettingJson),
      CORTEX_API_URL: JSON.stringify(
        `http://127.0.0.1:${process.env.CORTEX_API_PORT ?? '39291'}`
      ),
      CORTEX_SOCKET_URL: JSON.stringify(
        `ws://127.0.0.1:${process.env.CORTEX_API_PORT ?? '39291'}`
      ),
      CORTEX_ENGINE_VERSION: JSON.stringify('v0.1.54'),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node', 'cpu-instructions'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts', '.json'],
    },
    define: {
      CORTEX_API_URL: JSON.stringify(
        `http://127.0.0.1:${process.env.CORTEX_API_PORT ?? '39291'}`
      ),
    },
    platform: 'node',
  },
])

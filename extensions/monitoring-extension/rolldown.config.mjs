import { defineConfig } from 'rolldown'
import packageJson from './package.json' with { type: 'json' }
import settingJson from './resources/settings.json' with { type: 'json' }

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
      SETTINGS: JSON.stringify(settingJson),
    },
  },
  {
    input: 'src/node/index.ts',
    external: ['@janhq/core/node'],
    output: {
      format: 'cjs',
      file: 'dist/node/index.cjs.js',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts', '.json'],
    },
    platform: 'node',
  },
])


import { defineConfig } from 'rolldown'
import pkgJson from './package.json' with { type: 'json' }
import settingJson from './settings.json' with { type: 'json' }

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
  },
  platform: 'browser',
  define: {
    SETTINGS: JSON.stringify(settingJson),
    ENGINE: JSON.stringify(pkgJson.engine),
    IS_MAC: JSON.stringify(process.platform === 'darwin'),
  },
  inject: process.env.IS_DEV ? {} : {
      fetch: ['@tauri-apps/plugin-http', 'fetch'],
  },
})

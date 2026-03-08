
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
    IS_WINDOWS: JSON.stringify(process.platform === 'win32'),
    IS_MAC: JSON.stringify(process.platform === 'darwin'),
    IS_LINUX: JSON.stringify(process.platform === 'linux'),
  },
  inject: process.env.IS_DEV ? {} : {
      fetch: ['@tauri-apps/plugin-http', 'fetch'],
  },
})

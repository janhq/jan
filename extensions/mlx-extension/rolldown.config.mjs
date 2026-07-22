
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
  // macOS-only plugin API; declared external so non-mac builds don't warn about
  // an unresolved import. The web bundle only pulls in mlx (and thus this dep)
  // on macOS, where it resolves.
  external: ['@janhq/tauri-plugin-mlx-api'],
  define: {
    SETTINGS: JSON.stringify(settingJson),
    ENGINE: JSON.stringify(pkgJson.engine),
    IS_MAC: JSON.stringify(process.platform === 'darwin'),
  },
  inject: process.env.IS_DEV ? {} : {
      fetch: ['@tauri-apps/plugin-http', 'fetch'],
  },
})

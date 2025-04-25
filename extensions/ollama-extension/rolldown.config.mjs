import { defineConfig } from 'rolldown'
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
      SETTINGS: JSON.stringify(defaultSettingJson),
      DEFAULT_PORT: '11434'
    },
  }
])

import { defineConfig } from 'rolldown'
import settingJson from './resources/settings.json' with { type: 'json' }
import modelSources from './resources/default.json' with { type: 'json' }

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
  },
  platform: 'browser',
  define: {
    SETTINGS: JSON.stringify(settingJson),
    API_URL: JSON.stringify(`http://127.0.0.1:${process.env.CORTEX_API_PORT ?? "39291"}`),
    DEFAULT_MODEL_SOURCES: JSON.stringify(modelSources),
  },
})

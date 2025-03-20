import { defineConfig } from 'rolldown'
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
      API_URL: JSON.stringify(`http://127.0.0.1:${process.env.CORTEX_API_PORT ?? "39291"}`),
    },
  },
])

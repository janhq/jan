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
      API_URL: JSON.stringify('http://127.0.0.1:39291'),
      SOCKET_URL: JSON.stringify('ws://127.0.0.1:39291'),
    },
  },
])

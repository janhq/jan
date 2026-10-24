import { defineConfig } from 'rolldown'
import pkgJson from './package.json' with { type: 'json' }

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
      sourcemap: true,
    },
    platform: 'browser',
    // The API package is a real dependency so that core and every extension
    // share one copy of its classes (DisposableStore, Emitter).
    external: ['path', 'react', 'react-dom', 'react/jsx-runtime', '@janhq/extension-api'],
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      VERSION: JSON.stringify(pkgJson.version),
    },
  }
])

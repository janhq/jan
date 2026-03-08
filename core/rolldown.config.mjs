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
    external: ['path', 'react', 'react-dom', 'react/jsx-runtime'],
    define: {
      NODE: JSON.stringify(`${pkgJson.name}/${pkgJson.node}`),
      VERSION: JSON.stringify(pkgJson.version),
    },
  }
])

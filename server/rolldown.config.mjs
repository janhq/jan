import { defineConfig } from 'rolldown'

export default defineConfig([
  {
    input: 'index.ts',
    output: {
      format: 'cjs',
      file: 'dist/index.js',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    resolve: {
      extensions: ['.js', '.ts'],
    },
    external: ['@fastify/swagger-ui'],
    platform: 'node',
    define: {
      CORTEX_API_URL: JSON.stringify(`http://127.0.0.1:${process.env.CORTEX_API_PORT ?? "39291"}`),
    }
  },
])

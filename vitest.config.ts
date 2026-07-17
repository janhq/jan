import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Core package - use its own vitest config
      './core',

      // Web-app package - use its own vitest config
      './web-app',

      // Extensions - each ships its own vitest config
      './extensions/assistant-extension',
      './extensions/conversational-extension',
      './extensions/download-extension',
      './extensions/llamacpp-extension',
      // mlx depends on @janhq/tauri-plugin-mlx-api, which only resolves on
      // macOS; skip its project elsewhere to avoid a resolve failure.
      ...(process.platform === 'darwin' ? ['./extensions/mlx-extension'] : []),
      './extensions/rag-extension',
      './extensions/vector-db-extension',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'docs',
        '**/*/dist',
        'node_modules',
        '**/src/**/*.test.ts',
        '**/src/**/*.test.tsx',
        '**/src/test/**/*',
        'src-tauri',
      ],
    },
  },
})

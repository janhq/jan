import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Core package - use its own vitest config
      './core',

      // Web-app package - use its own vitest config
      './web-app',

      // Extensions that ship their own tests
      './extensions/llamacpp-extension',
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
        'extensions',
      ],
    },
  },
})

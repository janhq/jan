import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const resolveHere = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      // Resolve the plugin to its guest-js source rather than the built
      // package: Node resolution picks dist-js/index.cjs, so the tests ran
      // against whatever was last built and could not observe the wrappers.
      '@janhq/tauri-plugin-llamacpp-api': resolveHere(
        '../../src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index.ts'
      ),
      // The plugin carries its own @tauri-apps/api install, so aliasing
      // guest-js in would otherwise give it a second module instance that
      // `vi.mock('@tauri-apps/api/core')` never intercepts -- the real invoke
      // would run and die on a missing window.__TAURI_INTERNALS__.
      '@tauri-apps/api/core': resolveHere(
        './node_modules/@tauri-apps/api/core.js'
      ),
    },
  },
})

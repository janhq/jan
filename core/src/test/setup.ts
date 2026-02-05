import { vi } from 'vitest'

// Ensure window exists in test environment  
if (typeof window === 'undefined') {
  global.window = {} as any
}

// Mock window.core for browser tests
if (!window.core) {
  Object.defineProperty(window, 'core', {
    value: {
      engineManager: undefined
    },
    writable: true,
    configurable: true
  })
}

// Add any other global mocks needed for core tests

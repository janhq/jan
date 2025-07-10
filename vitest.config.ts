import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Core package - use its own vitest config
      './core',
      
      // Web-app package - use its own vitest config  
      './web-app'
    ]
  }
})
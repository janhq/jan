/**
 * Default Theme Service - Generic implementation with minimal returns
 */

import type { ThemeService } from './types'

export class DefaultThemeService implements ThemeService {
  async setTheme(): Promise<void> {
    // No-op - not implemented in default service
  }

  getCurrentWindow() {
    return {
      setTheme: (): Promise<void> => {
        return Promise.resolve()
      }
    }
  }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Theme Service - Generic implementation with minimal returns
 */

import type { ThemeService, ThemeMode } from './types'

export class DefaultThemeService implements ThemeService {
  async setTheme(theme: ThemeMode): Promise<void> {
    // No-op
  }

  getCurrentWindow() {
    return {
      setTheme: (theme: ThemeMode): Promise<void> => {
        return Promise.resolve()
      }
    }
  }
}
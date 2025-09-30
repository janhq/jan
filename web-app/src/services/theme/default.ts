/**
 * Default Theme Service - Generic implementation with minimal returns
 */

import type { ThemeService, ThemeMode } from './types'

export class DefaultThemeService implements ThemeService {
  async setTheme(theme: ThemeMode): Promise<void> {
    console.log('setTheme called with theme:', theme)
    // No-op - not implemented in default service
  }

  getCurrentWindow() {
    return {
      setTheme: (theme: ThemeMode): Promise<void> => {
        console.log('window.setTheme called with theme:', theme)
        return Promise.resolve()
      }
    }
  }
}

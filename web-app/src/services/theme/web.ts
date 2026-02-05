/**
 * Web Theme Service - Web implementation
 */

import type { ThemeService, ThemeMode } from './types'

export class WebThemeService implements ThemeService {
  async setTheme(theme: ThemeMode): Promise<void> {
    console.log('Setting theme in web mode:', theme)
    // In web mode, we can apply theme by setting CSS classes or data attributes
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }

  getCurrentWindow() {
    return {
      setTheme: (theme: ThemeMode): Promise<void> => {
        return this.setTheme(theme)
      }
    }
  }
}

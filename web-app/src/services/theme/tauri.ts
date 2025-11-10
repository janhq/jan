/**
 * Tauri Theme Service - Desktop implementation
 */

import { getCurrentWindow, Theme } from '@tauri-apps/api/window'
import type { ThemeMode } from './types'
import { DefaultThemeService } from './default'

export class TauriThemeService extends DefaultThemeService {
  async setTheme(theme: ThemeMode): Promise<void> {
    try {
      const tauriTheme = theme as Theme | null
      await getCurrentWindow().setTheme(tauriTheme)
    } catch (error) {
      console.error('Error setting theme in Tauri:', error)
      throw error
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
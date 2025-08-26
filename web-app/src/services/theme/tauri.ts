/**
 * Tauri Theme Service - Desktop implementation
 * 
 * MOVED FROM: src/hooks/useTheme.ts (Tauri-specific getCurrentWindow().setTheme calls)
 * NO IMPLEMENTATION CHANGES - EXACT SAME LOGIC MOVED HERE
 */

import { getCurrentWindow, Theme } from '@tauri-apps/api/window'
import type { ThemeMode } from './types'
import { DefaultThemeService } from './default'

export class TauriThemeService extends DefaultThemeService {
  async setTheme(theme: ThemeMode): Promise<void> {
    try {
      // MOVED FROM useTheme.ts - exact same implementation
      const tauriTheme = theme as Theme | null
      await getCurrentWindow().setTheme(tauriTheme)
    } catch (error) {
      console.error('Error setting theme in Tauri, falling back to default:', error)
      // Fallback to default implementation
      return super.setTheme(theme)
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
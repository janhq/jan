/**
 * Tauri Window Service - Desktop implementation
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { WindowConfig, WebviewWindowInstance } from './types'
import { DefaultWindowService } from './default'

export class TauriWindowService extends DefaultWindowService {
  async createWebviewWindow(
    config: WindowConfig
  ): Promise<WebviewWindowInstance> {
    try {
      // Get current theme from localStorage
      const storedTheme = localStorage.getItem('jan-theme')
      let theme: 'light' | 'dark' | undefined = undefined

      if (storedTheme) {
        try {
          const themeData = JSON.parse(storedTheme)
          const activeTheme = themeData?.state?.activeTheme
          const isDark = themeData?.state?.isDark

          // Set theme based on stored preference
          if (activeTheme === 'auto') {
            theme = undefined // Let OS decide
          } else if (
            activeTheme === 'dark' ||
            (activeTheme === 'auto' && isDark)
          ) {
            theme = 'dark'
          } else if (
            activeTheme === 'light' ||
            (activeTheme === 'auto' && !isDark)
          ) {
            theme = 'light'
          }
        } catch (e) {
          console.warn('Failed to parse theme from localStorage:', e)
        }
      }

      const webviewWindow = new WebviewWindow(config.label, {
        url: config.url,
        title: config.title,
        width: config.width,
        height: config.height,
        center: config.center,
        resizable: config.resizable,
        minimizable: config.minimizable,
        maximizable: config.maximizable,
        closable: config.closable,
        fullscreen: config.fullscreen,
        theme: theme,
      })

      // Setup theme listener for this window
      this.setupThemeListenerForWindow(webviewWindow)

      return {
        label: config.label,
        async close() {
          await webviewWindow.close()
        },
        async show() {
          await webviewWindow.show()
        },
        async hide() {
          await webviewWindow.hide()
        },
        async focus() {
          await webviewWindow.setFocus()
        },
        async setTitle(title: string) {
          await webviewWindow.setTitle(title)
        },
      }
    } catch (error) {
      console.error('Error creating Tauri window:', error)
      throw error
    }
  }

  async getWebviewWindowByLabel(
    label: string
  ): Promise<WebviewWindowInstance | null> {
    try {
      const existingWindow = await WebviewWindow.getByLabel(label)

      if (existingWindow) {
        return {
          label: label,
          async close() {
            await existingWindow.close()
          },
          async show() {
            await existingWindow.show()
          },
          async hide() {
            await existingWindow.hide()
          },
          async focus() {
            await existingWindow.setFocus()
          },
          async setTitle(title: string) {
            await existingWindow.setTitle(title)
          },
        }
      }

      return null
    } catch (error) {
      console.error('Error getting Tauri window by label:', error)
      return null
    }
  }

  async openWindow(config: WindowConfig): Promise<void> {
    // Check if window already exists first
    const existing = await this.getWebviewWindowByLabel(config.label)
    if (existing) {
      await existing.show()
      await existing.focus()
    } else {
      await this.createWebviewWindow(config)
    }
  }

  async openLogsWindow(): Promise<void> {
    try {
      await this.openWindow({
        url: '/logs',
        label: 'logs-app-window',
        title: 'App Logs - Jan',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
      })
    } catch (error) {
      console.error('Error opening logs window in Tauri:', error)
      throw error
    }
  }

  async openSystemMonitorWindow(): Promise<void> {
    try {
      await this.openWindow({
        url: '/system-monitor',
        label: 'system-monitor-window',
        title: 'System Monitor - Jan',
        width: 1000,
        height: 700,
        resizable: true,
        center: true,
      })
    } catch (error) {
      console.error('Error opening system monitor window in Tauri:', error)
      throw error
    }
  }

  async openLocalApiServerLogsWindow(): Promise<void> {
    try {
      await this.openWindow({
        url: '/local-api-server/logs',
        label: 'logs-window-local-api-server',
        title: 'Local API Server Logs - Jan',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
      })
    } catch (error) {
      console.error(
        'Error opening local API server logs window in Tauri:',
        error
      )
      throw error
    }
  }

  private setupThemeListenerForWindow(window: WebviewWindow): void {
    // Listen to theme change events from Tauri backend
    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        return listen<string>('theme-changed', async (event) => {
          const theme = event.payload
          try {
            if (theme === 'dark') {
              await window.setTheme('dark')
            } else if (theme === 'light') {
              await window.setTheme('light')
            } else {
              await window.setTheme(null)
            }
          } catch (err) {
            console.error('Failed to update window theme:', err)
          }
        })
      })
      .catch((err) => {
        console.error('Failed to setup theme listener for window:', err)
      })
  }
}

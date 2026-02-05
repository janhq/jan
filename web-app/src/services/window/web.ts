/**
 * Web Window Service - Web implementation
 */

import type { WindowService, WindowConfig, WebviewWindowInstance } from './types'

export class WebWindowService implements WindowService {
  async createWebviewWindow(config: WindowConfig): Promise<WebviewWindowInstance> {
    console.log('Creating window in web mode:', config)
    
    // Web implementation - open in new tab/window
    const newWindow = window.open(config.url, config.label, 
      `width=${config.width || 800},height=${config.height || 600},resizable=${config.resizable !== false ? 'yes' : 'no'}`
    )
    
    if (!newWindow) {
      throw new Error('Failed to create window - popup blocked?')
    }

    return {
      label: config.label,
      async close() {
        newWindow.close()
      },
      async show() {
        newWindow.focus()
      },
      async hide() {
        // Can't really hide a window in web, just minimize focus
        console.log('Hide not supported in web mode')
      },
      async focus() {
        newWindow.focus()
      },
      async setTitle(title: string) {
        if (newWindow.document) {
          newWindow.document.title = title
        }
      }
    }
  }

  async getWebviewWindowByLabel(label: string): Promise<WebviewWindowInstance | null> {
    console.log('Getting window by label in web mode:', label)
    // Web implementation can't track windows across sessions
    return null
  }

  async openWindow(config: WindowConfig): Promise<void> {
    await this.createWebviewWindow(config)
  }

  async openLogsWindow(): Promise<void> {
    console.warn('Cannot open logs window in web environment')
  }

  async openSystemMonitorWindow(): Promise<void> {
    console.warn('Cannot open system monitor window in web environment')
  }

  async openLocalApiServerLogsWindow(): Promise<void> {
    console.warn('Cannot open local API server logs window in web environment')
  }
}

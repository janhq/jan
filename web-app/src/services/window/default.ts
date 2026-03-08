/**
 * Default Window Service - Generic implementation with minimal returns
 */

import type { WindowService, WindowConfig, WebviewWindowInstance } from './types'

export class DefaultWindowService implements WindowService {
  async createWebviewWindow(config: WindowConfig): Promise<WebviewWindowInstance> {
    return {
      label: config.label,
      async close() { /* No-op */ },
      async show() { /* No-op */ },
      async hide() { /* No-op */ },
      async focus() { /* No-op */ },
      async setTitle(title: string) { 
        console.log('window.setTitle called with title:', title)
        /* No-op */ 
      }
    }
  }

  async getWebviewWindowByLabel(label: string): Promise<WebviewWindowInstance | null> {
    console.log('getWebviewWindowByLabel called with label:', label)
    return null
  }

  async openWindow(config: WindowConfig): Promise<void> {
    console.log('openWindow called with config:', config)
    // No-op - not implemented in default service
  }

  async openLogsWindow(): Promise<void> {
    // No-op
  }

  async openSystemMonitorWindow(): Promise<void> {
    // No-op
  }

  async openLocalApiServerLogsWindow(): Promise<void> {
    // No-op
  }
}

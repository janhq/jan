/* eslint-disable @typescript-eslint/no-unused-vars */
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
      async setTitle(title: string) { /* No-op */ }
    }
  }

  async getWebviewWindowByLabel(label: string): Promise<WebviewWindowInstance | null> {
    return null
  }

  async openWindow(config: WindowConfig): Promise<void> {
    // No-op
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
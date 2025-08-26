/**
 * Web Updater Service - Web implementation
 * Provides fallback implementations for update operations
 */

import type { UpdaterService, UpdateInfo } from './types'

export class WebUpdaterService implements UpdaterService {
  async check(): Promise<UpdateInfo | null> {
    // Web fallback - no auto-update capability
    console.warn('Auto-update not supported in web environment')
    return null
  }

  async installAndRestart(): Promise<void> {
    // Web fallback - can't restart app
    console.warn('Install and restart not supported in web environment')
  }
}
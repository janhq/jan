/**
 * Default Updater Service - Generic implementation with minimal returns
 */

import type { UpdaterService, UpdateInfo } from './types'

export class DefaultUpdaterService implements UpdaterService {
  async check(): Promise<UpdateInfo | null> {
    return null
  }

  async installAndRestart(): Promise<void> {
    // No-op
  }
}
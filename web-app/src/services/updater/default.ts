/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Updater Service - Generic implementation with minimal returns
 */

import type { UpdaterService, UpdateInfo, UpdateProgressEvent } from './types'

export class DefaultUpdaterService implements UpdaterService {
  async check(): Promise<UpdateInfo | null> {
    return null
  }

  async installAndRestart(): Promise<void> {
    // No-op
  }

  async downloadAndInstallWithProgress(
    progressCallback: (event: UpdateProgressEvent) => void
  ): Promise<void> {
    // No-op for non-Tauri platforms
  }
}
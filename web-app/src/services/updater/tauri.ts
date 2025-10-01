/**
 * Tauri Updater Service - Desktop implementation
 */

import { check, Update } from '@tauri-apps/plugin-updater'
import type { UpdateInfo, UpdateProgressEvent } from './types'
import { DefaultUpdaterService } from './default'

export class TauriUpdaterService extends DefaultUpdaterService {
  async check(): Promise<UpdateInfo | null> {
    try {
      const update: Update | null = await check()
      
      if (!update) return null

      return {
        version: update.version,
        date: update.date,
        body: update.body,
      }
    } catch (error) {
      console.error('Error checking for updates in Tauri:', error)
      return null
    }
  }

  async installAndRestart(): Promise<void> {
    try {
      const update = await check()
      if (update) {
        await update.downloadAndInstall()
        // Note: Auto-restart happens after installation
      }
    } catch (error) {
      console.error('Error installing update in Tauri:', error)
      throw error
    }
  }

  async downloadAndInstallWithProgress(
    progressCallback: (event: UpdateProgressEvent) => void
  ): Promise<void> {
    try {
      const update = await check()
      if (!update) {
        throw new Error('No update available')
      }

      // Use Tauri's downloadAndInstall with progress callback
      await update.downloadAndInstall((event) => {
        try {
          // Forward the event to the callback
          progressCallback(event as UpdateProgressEvent)
        } catch (callbackError) {
          console.warn('Error in download progress callback:', callbackError)
        }
      })
    } catch (error) {
      console.error('Error downloading update with progress in Tauri:', error)
      throw error
    }
  }
}

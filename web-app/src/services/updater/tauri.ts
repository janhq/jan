/**
 * Tauri Updater Service - Desktop implementation
 * 
 * This service uses a custom update check with HMAC request signing:
 * 1. First tries primary endpoint (from tauri.conf.json) with signed request
 * 2. Falls back to other endpoints without signing if primary fails
 * 3. Uses Tauri's built-in updater for download/install (with signature verification)
 */

import { check, Update } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import type { UpdateInfo, UpdateProgressEvent } from './types'
import { DefaultUpdaterService } from './default'

// Store key for nonce seed
const STORE_NAME = 'updater.json'
const NONCE_SEED_KEY = 'nonce_seed'

// Cache nonce seed in memory to avoid repeated store reads
let cachedNonceSeed: string | null = null

// Get or generate nonce seed for request signing (persisted in app data folder)
async function getNonceSeed(): Promise<string> {
  // Return cached value if available
  if (cachedNonceSeed) {
    return cachedNonceSeed
  }

  try {
    const store = await load(STORE_NAME, { autoSave: true, defaults: {} })
    let nonceSeed = await store.get<string>(NONCE_SEED_KEY)
    
    if (!nonceSeed) {
      nonceSeed = crypto.randomUUID()
      await store.set(NONCE_SEED_KEY, nonceSeed)
      await store.save()
    }
    
    cachedNonceSeed = nonceSeed
    return nonceSeed
  } catch (error) {
    // Fallback to random seed if store fails
    console.warn('Failed to access store for nonce seed, using temporary seed:', error)
    const tempSeed = crypto.randomUUID()
    cachedNonceSeed = tempSeed
    return tempSeed
  }
}

// Get current app version
async function getCurrentVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return '0.0.0'
  }
}

export class TauriUpdaterService extends DefaultUpdaterService {
  /**
   * Check for updates using custom signed request for primary endpoint
   * Falls back to standard Tauri updater if custom check fails
   */
  async check(): Promise<UpdateInfo | null> {
    try {
      const nonceSeed = await getNonceSeed()
      const currentVersion = await getCurrentVersion()

      // Try custom updater with request signing first
      try {
        const customUpdate = await invoke<{
          version: string
          notes?: string
          pub_date?: string
          url?: string
          signature?: string
        } | null>('check_for_app_updates', {
          nonceSeed,
          currentVersion,
        })

        if (customUpdate) {
          console.log('Update found via custom updater:', customUpdate.version)
          return {
            version: customUpdate.version,
            date: customUpdate.pub_date,
            body: customUpdate.notes,
            signature: customUpdate.signature,
          }
        }
      } catch (customError) {
        console.warn('Custom updater check failed, falling back to standard Tauri updater:', customError)
      }

      // Fallback to standard Tauri updater (uses tauri.conf.json endpoints)
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


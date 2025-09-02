/**
 * Tauri Deep Link Service - Desktop implementation
 */

import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'
// import type { DeepLinkService } from './types'
import { DefaultDeepLinkService } from './default'

export class TauriDeepLinkService extends DefaultDeepLinkService {
  async onOpenUrl(handler: (urls: string[]) => void): Promise<() => void> {
    try {
      return await onOpenUrl(handler)
    } catch (error) {
      console.error('Error setting up deep link handler in Tauri, falling back to default:', error)
      return super.onOpenUrl(handler)
    }
  }

  async getCurrent(): Promise<string[]> {
    try {
      const result = await getCurrent()
      return result ?? []
    } catch (error) {
      console.error('Error getting current deep links in Tauri, falling back to default:', error)
      return super.getCurrent()
    }
  }
}
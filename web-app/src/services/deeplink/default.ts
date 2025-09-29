/**
 * Default Deep Link Service - Generic implementation with minimal returns
 */

import type { DeepLinkService } from './types'

export class DefaultDeepLinkService implements DeepLinkService {
  async onOpenUrl(handler: (urls: string[]) => void): Promise<() => void> {
    console.log('onOpenUrl called with handler:', typeof handler)
    return () => {
      // No-op unlisten
    }
  }

  async getCurrent(): Promise<string[]> {
    return []
  }
}
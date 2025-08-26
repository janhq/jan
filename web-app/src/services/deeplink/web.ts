/**
 * Web Deep Link Service - Web implementation
 * Provides web-specific implementations for deep link operations
 */

import type { DeepLinkService } from './types'

export class WebDeepLinkService implements DeepLinkService {
  async onOpenUrl(handler: (urls: string[]) => void): Promise<() => void> {
    // Web fallback - listen to URL changes
    const handleHashChange = () => {
      const url = window.location.href
      handler([url])
    }

    window.addEventListener('hashchange', handleHashChange)
    
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }

  async getCurrent(): Promise<string[]> {
    // Return current URL
    return [window.location.href]
  }
}
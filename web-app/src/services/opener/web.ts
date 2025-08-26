/**
 * Web Opener Service - Web implementation
 * Provides fallback implementations for file/folder operations
 */

import type { OpenerService } from './types'

export class WebOpenerService implements OpenerService {
  async revealItemInDir(path: string): Promise<void> {
    // Web fallback - log the action
    console.warn(`Cannot reveal item in directory on web: ${path}`)
  }

  async openPath(path: string): Promise<void> {
    // Web fallback - try to open as URL if it looks like one
    if (path.startsWith('http://') || path.startsWith('https://')) {
      window.open(path, '_blank')
    } else {
      console.warn(`Cannot open path on web: ${path}`)
    }
  }
}
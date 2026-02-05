/**
 * Web Path Service - Web implementation
 * Provides web-specific implementations for path operations
 */

import type { PathService } from './types'

export class WebPathService implements PathService {
  sep(): string {
    // Web fallback - assume unix-style paths
    return '/'
  }

  async join(...segments: string[]): Promise<string> {
    return segments
      .filter(segment => segment && segment !== '')
      .join('/')
      .replace(/\/+/g, '/') // Remove double slashes
  }

  async dirname(path: string): Promise<string> {
    const normalizedPath = path.replace(/\\/g, '/')
    const lastSlash = normalizedPath.lastIndexOf('/')
    if (lastSlash === -1) return '.'
    if (lastSlash === 0) return '/'
    return normalizedPath.substring(0, lastSlash)
  }

  async basename(path: string): Promise<string> {
    const normalizedPath = path.replace(/\\/g, '/')
    return normalizedPath.split('/').pop() || ''
  }

  async extname(path: string): Promise<string> {
    const basename = await this.basename(path)
    const lastDot = basename.lastIndexOf('.')
    if (lastDot === -1 || lastDot === 0) return ''
    return basename.substring(lastDot)
  }
}

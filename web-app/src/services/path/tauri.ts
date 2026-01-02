/**
 * Tauri Path Service - Desktop implementation
 */

import { sep as getSep, join, dirname, basename, extname } from '@tauri-apps/api/path'
import { DefaultPathService } from './default'

export class TauriPathService extends DefaultPathService {
  sep(): string {
    try {
      // Note: sep() is synchronous in Tauri v2 (unlike other path functions)
      return getSep() as unknown as string
    } catch (error) {
      console.error('Error getting path separator in Tauri:', error)
      return '/'
    }
  }

  async join(...segments: string[]): Promise<string> {
    try {
      return await join(...segments)
    } catch (error) {
      console.error('Error joining paths in Tauri:', error)
      return segments.join('/')
    }
  }

  async dirname(path: string): Promise<string> {
    try {
      return await dirname(path)
    } catch (error) {
      console.error('Error getting dirname in Tauri:', error)
      const lastSlash = path.lastIndexOf('/')
      return lastSlash > 0 ? path.substring(0, lastSlash) : '.'
    }
  }

  async basename(path: string): Promise<string> {
    try {
      return await basename(path)
    } catch (error) {
      console.error('Error getting basename in Tauri:', error)
      const normalizedPath = path.replace(/\\/g, '/')
      return normalizedPath.split('/').pop() || ''
    }
  }

  async extname(path: string): Promise<string> {
    try {
      return await extname(path)
    } catch (error) {
      console.error('Error getting extname in Tauri:', error)
      const lastDot = path.lastIndexOf('.')
      const lastSlash = path.lastIndexOf('/')
      return lastDot > lastSlash ? path.substring(lastDot) : ''
    }
  }
}

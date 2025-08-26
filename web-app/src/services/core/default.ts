/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Default Core Service - Generic implementation with minimal returns
 */

import type { ExtensionManifest } from '@/lib/extension'
import type { CoreService, InvokeArgs } from './types'

export class DefaultCoreService implements CoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    throw new Error('Core invoke not implemented')
  }

  convertFileSrc(filePath: string, protocol?: string): string {
    return filePath
  }

  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    return []
  }

  async installExtensions(): Promise<void> {
    // No-op
  }

  async installExtension(extensions: ExtensionManifest[]): Promise<ExtensionManifest[]> {
    // No-op in default implementation
    return extensions
  }

  async uninstallExtension(extensions: string[], reload = true): Promise<boolean> {
    // No-op in default implementation
    return Promise.resolve(false)
  }

  async getAppToken(): Promise<string | null> {
    return null
  }
}
/**
 * Default Core Service - Web implementation with bundled extensions
 */

import type { ExtensionManifest } from '@/lib/extension'
import type { CoreService, InvokeArgs } from './types'

export class DefaultCoreService implements CoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    console.log('Core invoke called:', { command, args })
    throw new Error('Core invoke not implemented')
  }

  convertFileSrc(filePath: string, _protocol?: string): string {
    return filePath
  }

  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    try {
      const { default: JanConversationalExtension } = await import(
        '@janhq/conversational-extension'
      )
      const extensionInstance = new JanConversationalExtension(
        'built-in',
        '@janhq/conversational-extension',
        'Conversational Extension',
        true,
        'Manages conversation threads and messages',
        '1.0.0'
      )
      return [
        {
          name: '@janhq/conversational-extension',
          productName: 'Conversational Extension',
          url: 'built-in',
          active: true,
          description: 'Manages conversation threads and messages',
          version: '1.0.0',
          extensionInstance,
        },
      ]
    } catch (error) {
      console.warn('Failed to load conversational extension:', error)
      return []
    }
  }

  async installExtensions(): Promise<void> {
    // No-op for web
  }

  async installExtension(extensions: ExtensionManifest[]): Promise<ExtensionManifest[]> {
    return extensions
  }

  async uninstallExtension(_extensions: string[], _reload = true): Promise<boolean> {
    return false
  }

  async getAppToken(): Promise<string | null> {
    return null
  }
}

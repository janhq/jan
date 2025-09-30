/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Web Core Service - Web implementation  
 * Provides web-specific implementations for core operations
 */

import type { ExtensionManifest } from '@/lib/extension'
import type { CoreService, InvokeArgs } from './types'
import type { WebExtensionRegistry, WebExtensionName } from '@jan/extensions-web'

export class WebCoreService implements CoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    console.warn(`Cannot invoke Tauri command '${command}' in web environment`, args)
    throw new Error(`Tauri invoke not available in web environment: ${command}`)
  }

  convertFileSrc(filePath: string, _protocol?: string): string {
    // For web extensions, handle special web:// URLs
    if (filePath.startsWith('web://')) {
      const extensionName = filePath.replace('web://', '')
      return `@jan/extensions-web/${extensionName}`
    }
    console.warn(`Cannot convert file src in web environment: ${filePath}`)
    return filePath
  }

  // Extension management - web implementation
  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    try {
      const { WEB_EXTENSIONS } = await import('@jan/extensions-web')
      const manifests: ExtensionManifest[] = []
      
      // Create manifests and register extensions
      const entries = Object.entries(WEB_EXTENSIONS) as [WebExtensionName, WebExtensionRegistry[WebExtensionName]][]
      for (const [name, loader] of entries) {
        try {
          // Load the extension module
          const extensionModule = await loader()
          const ExtensionClass = extensionModule.default
          
          // Create manifest data with extension instance
          const manifest = {
            url: `web://${name}`,
            name,
            productName: name,
            active: true,
            description: `Web extension: ${name}`,
            version: '1.0.0',
            extensionInstance: new ExtensionClass(
              `web://${name}`,
              name,
              name, // productName
              true, // active
              `Web extension: ${name}`, // description
              '1.0.0' // version
            )
          }
          
          manifests.push(manifest)
        } catch (error) {
          console.error(`Failed to register web extension '${name}':`, error)
        }
      }
      
      return manifests
    } catch (error) {
      console.error('Failed to get web extensions:', error)
      return []
    }
  }

  async installExtensions(): Promise<void> {
    console.warn('Extension installation not available in web environment')
  }

  async installExtension(extensions: ExtensionManifest[]): Promise<ExtensionManifest[]> {
    console.warn('Extension installation not available in web environment')
    return extensions
  }

  async uninstallExtension(extensions: string[], reload = true): Promise<boolean> {
    console.log('uninstallExtension called:', { extensions, reload })
    console.warn('Extension uninstallation not available in web environment')
    return false
  }

  // App token - web fallback
  async getAppToken(): Promise<string | null> {
    console.warn('App token not available in web environment')
    return null
  }
}

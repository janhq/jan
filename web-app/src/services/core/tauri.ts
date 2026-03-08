/**
 * Tauri Core Service - Desktop implementation
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type { ExtensionManifest } from '@/lib/extension'
import type { InvokeArgs } from './types'
import { DefaultCoreService } from './default'

export class TauriCoreService extends DefaultCoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    try {
      return await invoke<T>(command, args)
    } catch (error) {
      console.error(`Error invoking Tauri command '${command}' in Tauri:`, error)
      throw error
    }
  }

  convertFileSrc(filePath: string, protocol?: string): string {
    try {
      return convertFileSrc(filePath, protocol)
    } catch (error) {
      console.error('Error converting file src in Tauri:', error)
      return filePath
    }
  }

  // Extension management - using invoke
  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    try {
      return await this.invoke<ExtensionManifest[]>('get_active_extensions')
    } catch (error) {
      console.error('Error getting active extensions in Tauri:', error)
      return []
    }
  }

  async installExtensions(): Promise<void> {
    try {
      return await this.invoke<void>('install_extensions')
    } catch (error) {
      console.error('Error installing extensions in Tauri:', error)
      throw error
    }
  }

  async installExtension(extensions: ExtensionManifest[]): Promise<ExtensionManifest[]> {
    try {
      return await this.invoke<ExtensionManifest[]>('install_extension', { extensions })
    } catch (error) {
      console.error('Error installing extension in Tauri:', error)
      return []
    }
  }

  async uninstallExtension(extensions: string[], reload = true): Promise<boolean> {
    try {
      return await this.invoke<boolean>('uninstall_extension', { extensions, reload })
    } catch (error) {
      console.error('Error uninstalling extension in Tauri:', error)
      return false
    }
  }

  // App token
  async getAppToken(): Promise<string | null> {
    try {
      const result = await this.invoke<string | null>('app_token')
      return result
    } catch (error) {
      console.error('Error getting app token in Tauri:', error)
      return null
    }
  }
}

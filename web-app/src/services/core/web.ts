/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Web Core Service - Web implementation  
 * Provides web-specific implementations for core operations
 */

import type { ExtensionManifest } from '@/lib/extension'
import type { CoreService, InvokeArgs } from './types'

export class WebCoreService implements CoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    console.warn(`Cannot invoke Tauri command '${command}' in web environment`, args)
    throw new Error(`Tauri invoke not available in web environment: ${command}`)
  }

  convertFileSrc(filePath: string, _protocol?: string): string {
    // Web fallback - return the path as-is or convert to data URL if needed
    console.warn(`Cannot convert file src in web environment: ${filePath}`)
    return filePath
  }

  // Extension management - web fallbacks
  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    console.warn('Extension management not available in web environment')
    return []
  }

  async installExtensions(): Promise<void> {
    console.warn('Extension installation not available in web environment')
  }

  // App token - web fallback
  async getAppToken(): Promise<string | null> {
    console.warn('App token not available in web environment')
    return null
  }
}
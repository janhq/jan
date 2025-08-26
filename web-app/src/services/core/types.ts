/**
 * Core Service Types
 * Types for core Tauri invoke functionality
 */

import type { ExtensionManifest } from '@/lib/extension'

export interface InvokeArgs {
  [key: string]: unknown
}

export interface CoreService {
  invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T>
  convertFileSrc(filePath: string, protocol?: string): string
  
  // Extension management
  getActiveExtensions(): Promise<ExtensionManifest[]>
  installExtensions(): Promise<void>
  
  // App token
  getAppToken(): Promise<string | null>
}
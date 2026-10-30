/**
 * Core Service Types
 * Types for core Tauri invoke functionality
 */

export interface InvokeArgs {
  [key: string]: unknown
}

export interface CoreService {
  invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T>
  convertFileSrc(filePath: string, protocol?: string): string

  // App token
  getAppToken(): Promise<string | null>
}

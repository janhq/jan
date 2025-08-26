/**
 * Updater Service Types
 * Types for application update operations
 */

export interface UpdateInfo {
  version: string
  date?: string
  body?: string
  signature?: string
}

export interface UpdaterService {
  check(): Promise<UpdateInfo | null>
  installAndRestart(): Promise<void>
}
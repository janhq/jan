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

export interface UpdateProgressEvent {
  event: 'Started' | 'Progress' | 'Finished'
  data?: {
    contentLength?: number
    chunkLength?: number
  }
}

export interface UpdaterService {
  check(): Promise<UpdateInfo | null>
  installAndRestart(): Promise<void>
  downloadAndInstallWithProgress(
    progressCallback: (event: UpdateProgressEvent) => void
  ): Promise<void>
}

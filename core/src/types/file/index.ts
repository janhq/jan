export type FileStat = {
  isDirectory: boolean
  size: number
}

export type DownloadState = {
  modelId: string // TODO: change to download id
  fileName: string
  time?: DownloadTime
  speed?: number

  percent: number
  size: DownloadSize
  downloadState: 'downloading' | 'error' | 'end'
  children?: DownloadState[]

  error?: string
  extensionId?: string
  localPath?: string
}

type DownloadTime = {
  elapsed: number
  remaining: number
}

type DownloadSize = {
  total: number
  transferred: number
}
/**
 * The file metadata
 */
export type FileMetadata = {
  /**
   * The origin file path.
   */
  file_path: string

  /**
   * The file name.
   */
  file_name: string
}

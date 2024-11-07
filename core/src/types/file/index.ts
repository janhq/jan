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
  downloadType?: DownloadType | string
  localPath?: string
}

export type DownloadType = 'model' | 'extension'

export type DownloadRequest = {
  /**
   * The URL to download the file from.
   */
  url: string

  /**
   * The local path to save the file to.
   */
  localPath: string

  /**
   * The extension ID of the extension that initiated the download.
   *
   * Can be extension name.
   */
  extensionId?: string

  /**
   * The model ID of the model that initiated the download.
   */
  modelId?: string

  /**
   * The download type.
   */
  downloadType?: DownloadType | string
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

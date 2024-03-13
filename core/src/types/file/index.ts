export type FileStat = {
  isDirectory: boolean
  size: number
}

export type DownloadState = {
  modelId: string // TODO: change to download id
  fileName: string
  time: DownloadTime
  speed: number

  percent: number
  size: DownloadSize
  downloadState: 'downloading' | 'error' | 'end'
  children?: DownloadState[]

  error?: string
  extensionId?: string
  downloadType?: DownloadType
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

  downloadType?: DownloadType
}

type DownloadTime = {
  elapsed: number
  remaining: number
}

type DownloadSize = {
  total: number
  transferred: number
}

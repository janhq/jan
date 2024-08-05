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

export interface DownloadState2 {
  /**
   * The id of a particular download. Being used to prevent duplication of downloads.
   */
  id: string

  /**
   * For displaying purposes.
   */
  title: string

  /**
   * The type of download.
   */
  type: DownloadType2

  /**
   * Percentage of the download.
   */
  progress: number

  /**
   * The status of the download.
   */
  status: DownloadStatus

  /**
   * Explanation of the error if the download failed.
   */
  error?: string

  /**
   * The actual downloads. [DownloadState] is just a group to supporting for download multiple files.
   */
  children: DownloadItem[]
}

export enum DownloadStatus {
  Pending = 'pending',
  Downloading = 'downloading',
  Error = 'error',
  Downloaded = 'downloaded',
}

export interface DownloadItem {
  /**
   * Filename of the download.
   */
  id: string

  time: {
    elapsed: number
    remaining: number
  }

  size: {
    total: number
    transferred: number
  }

  checksum?: string

  status: DownloadStatus

  error?: string

  metadata?: Record<string, unknown>
}

export interface DownloadStateEvent {
  data: DownloadState[]
}

export enum DownloadType2 {
  Model = 'model',
  Miscelanous = 'miscelanous',
  Engine = 'engine',
}

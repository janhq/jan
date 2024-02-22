export type FileStat = {
  isDirectory: boolean
  size: number
}

export type DownloadState = {
  modelId: string
  fileName: string
  time: DownloadTime
  speed: number
  percent: number

  size: DownloadSize
  children?: DownloadState[]
  error?: string
  downloadState: 'downloading' | 'error' | 'end'
}

type DownloadTime = {
  elapsed: number
  remaining: number
}

type DownloadSize = {
  total: number
  transferred: number
}

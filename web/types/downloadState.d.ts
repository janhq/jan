type DownloadState = {
  modelId: string
  filename: string
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

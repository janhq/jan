type DownloadState = {
  modelId: string
  time: DownloadTime
  speed: number
  percent: number
  size: DownloadSize
  fileName: string
  error?: string
}

type DownloadTime = {
  elapsed: number
  remaining: number
}

type DownloadSize = {
  total: number
  transferred: number
}

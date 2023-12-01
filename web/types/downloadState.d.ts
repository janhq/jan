type DownloadState = {
  modelId: string
  time: DownloadTime
  speed: number
  percent: number
  size: DownloadSize
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

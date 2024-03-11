export type FileDownloadRequest = {
  downloadId: string
  url: string
  localPath: string
  fileName: string
  displayName: string
  metadata: Record<string, string | number>
}

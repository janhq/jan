import { DownloadItem, DownloadState2 } from '@janhq/core'

export const downloadProgress = (downloadState: DownloadState2 | undefined) => {
  if (!downloadState) return 0
  const downloadItems = downloadState.children
  // if any downloadItems total equal 0 then return 0
  if (downloadItems.some((downloadItem) => downloadItem.size.total === 0)) {
    return 0
  }

  const total = downloadItems.reduce(
    (sum: number, downloadItem: DownloadItem) => sum + downloadItem.size.total,
    0
  )
  const transferred = downloadItems.reduce(
    (sum: number, downloadItem: DownloadItem) =>
      sum + downloadItem.size.transferred,
    0
  )
  return total === 0 ? 0 : transferred / total
}

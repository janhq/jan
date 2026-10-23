/**
 * Typed access to the host download manager (`core::downloads`), which streams
 * files to disk with pause/resume and cancellation per task id.
 */

/**
 * A file to download. Field names match the Rust `DownloadItem` the host
 * deserializes, hence snake_case.
 */
export type DownloadItem = {
  url: string
  save_path: string
  proxy?: Record<string, string | string[] | boolean>
  sha256?: string
  size?: number
  model_id?: string
}

/**
 * Cumulative byte progress of a download task across all of its items.
 */
export type DownloadProgress = {
  transferred: number
  total: number
}

export type DownloadProgressHandler = (progress: DownloadProgress) => void

export type Unsubscribe = () => void

/**
 * Downloads every item under one task id; resolves once all items are on disk.
 * Re-using the id of a running task cancels that task first.
 */
const downloadFiles: (
  items: DownloadItem[],
  taskId: string,
  headers: Record<string, string>
) => Promise<void> = (items, taskId, headers) =>
  globalThis.core.api?.downloadFiles({ items, taskId, headers })

/**
 * Cancels a task and discards its partial files.
 */
const cancelDownload: (taskId: string) => Promise<void> = (taskId) =>
  globalThis.core.api?.cancelDownloadTask({ taskId })

/**
 * Stops a task but keeps its partial files, so downloading the same task id
 * again resumes it.
 */
const pauseDownload: (taskId: string) => Promise<void> = (taskId) =>
  globalThis.core.api?.pauseDownloadTask({ taskId })

/**
 * Subscribes to progress updates of one task.
 * @returns a function that ends the subscription.
 */
const onDownloadProgress: (
  taskId: string,
  handler: DownloadProgressHandler
) => Promise<Unsubscribe> = async (taskId, handler) =>
  (await globalThis.core.api?.onDownloadProgress?.(taskId, handler)) ?? (() => {})

export const downloads = { downloadFiles, cancelDownload, pauseDownload, onDownloadProgress }

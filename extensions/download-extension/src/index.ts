import {
  HUGGINGFACE_TOKEN_SECRET_KEY,
  ServiceKeys,
  type DownloadItem,
  type DownloadService,
  type InternalExtensionContext,
} from '@janhq/core'

// Where the pre-host extension kept its settings (the hf-token copy). The
// token now comes from the keyring, so the copy has nothing to carry over.
const LEGACY_SETTINGS_KEY = '@janhq/download-extension'

export async function activate(ctx: InternalExtensionContext): Promise<void> {
  localStorage.removeItem(LEGACY_SETTINGS_KEY)
  ctx.subscriptions.add(
    ctx.internal.services.provide(ServiceKeys.Downloads, createDownloads(ctx))
  )
}

function createDownloads(ctx: InternalExtensionContext): DownloadService {
  const { downloads, secrets } = ctx.internal

  // Read per download rather than cached at activation: the token can change
  // in Settings at any time and the keyring is the only copy. An unreadable
  // keyring must not block public downloads, so it degrades to no token.
  const headers = async (): Promise<Record<string, string>> => {
    const token = await secrets
      .get(HUGGINGFACE_TOKEN_SECRET_KEY)
      .catch((error: unknown) => {
        ctx.log.warn('Could not read the Hugging Face token:', error)
        return null
      })
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  const downloadFiles = async (
    items: DownloadItem[],
    taskId: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void> => {
    const unsubscribe = await downloads.onDownloadProgress(
      taskId,
      (progress) => onProgress?.(progress.transferred, progress.total)
    )
    try {
      await downloads.downloadFiles(items, taskId, await headers())
    } catch (error) {
      ctx.log.error('Error downloading task', taskId, error)
      throw error
    } finally {
      unsubscribe()
    }
  }

  return {
    downloadFiles,
    downloadFile: (url, savePath, taskId, proxyConfig = {}, onProgress) =>
      downloadFiles(
        [{ url, save_path: savePath, proxy: proxyConfig }],
        taskId,
        onProgress
      ),
    cancelDownload: async (taskId) => {
      try {
        await downloads.cancelDownload(taskId)
      } catch (error) {
        ctx.log.error('Error cancelling download:', error)
        throw error
      }
    },
    pauseDownload: async (taskId) => {
      try {
        await downloads.pauseDownload(taskId)
      } catch (error) {
        ctx.log.error('Error pausing download:', error)
        throw error
      }
    },
  }
}

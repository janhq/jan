import { BaseExtension, downloads, logger } from '@janhq/core'
import type { DownloadItem } from '@janhq/core'

export enum Settings {
  hfToken = 'hf-token',
}

export default class DownloadManager extends BaseExtension {
  hfToken?: string

  async onLoad() {
    this.registerSettings(SETTINGS)
    this.hfToken = await this.getSetting<string>(Settings.hfToken, undefined)
  }

  async onUnload() {}

  async downloadFile(
    url: string,
    savePath: string,
    taskId: string,
    proxyConfig: Record<string, string | string[] | boolean> = {},
    onProgress?: (transferred: number, total: number) => void
  ) {
    return await this.downloadFiles(
      [{ url, save_path: savePath, proxy: proxyConfig }],
      taskId,
      onProgress
    )
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.hfToken) {
      this.hfToken = value as string
    }
  }

  async downloadFiles(
    items: DownloadItem[],
    taskId: string,
    onProgress?: (transferred: number, total: number) => void
  ) {
    const unsubscribe = await downloads.onDownloadProgress(
      taskId,
      (progress) => {
        if (onProgress) {
          onProgress(progress.transferred, progress.total)
        }
      }
    )

    try {
      await downloads.downloadFiles(items, taskId, this._getHeaders())
    } catch (error) {
      logger.error('Error downloading task', taskId, error)
      throw error
    } finally {
      unsubscribe()
    }
  }

  async cancelDownload(taskId: string) {
    try {
      await downloads.cancelDownload(taskId)
    } catch (error) {
      logger.error('Error cancelling download:', error)
      throw error
    }
  }

  async pauseDownload(taskId: string) {
    try {
      await downloads.pauseDownload(taskId)
    } catch (error) {
      logger.error('Error pausing download:', error)
      throw error
    }
  }

  _getHeaders(): Record<string, string> {
    return {
      ...(this.hfToken && { Authorization: `Bearer ${this.hfToken}` }),
    }
  }
}

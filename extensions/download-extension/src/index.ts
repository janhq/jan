import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BaseExtension, events } from '@janhq/core';

export enum Settings {
  hfToken = 'hf-token',
}

type DownloadEvent = {
  task_id: string
  total_size: number
  downloaded_size: number
  download_type: string
  event_type: string
}

export default class DownloadManager extends BaseExtension {
  hf_token?: string

  async onLoad() {
    this.registerSettings(SETTINGS)
    this.hf_token = await this.getSetting<string>(Settings.hfToken, undefined)
  }

  async onUnload() { }

  async downloadFile(url: string, path: string) {
    // relay tauri events to Jan events
    const unlisten = await listen<DownloadEvent>('download', (event) => {
      let payload = event.payload
      let eventName = {
        Updated: 'onFileDownloadUpdate',
        Error: 'onFileDownloadError',
        Success: 'onFileDownloadSuccess',
        Stopped: 'onFileDownloadStopped',
        Started: 'onFileDownloadStarted',
      }[payload.event_type]

      events.emit(eventName, {
        modelId: payload.task_id,
        percent: payload.downloaded_size / payload.total_size,
        size: {
          transferred: payload.downloaded_size,
          total: payload.total_size,
        },
        downloadType: payload.download_type,
      })
    })

    try {
      await invoke<void>("download_file", { url, path, headers: this._getHeaders() })
    } catch (error) {
      console.error("Error downloading file:", error)
      events.emit('onFileDownloadError', {
        modelId: url,
        downloadType: 'Model',
      })
      throw error
    } finally {
      unlisten()
    }
  }

  async downloadHfRepo(modelId: string, saveDir: string, branch?: string) {
    // relay tauri events to Jan events
    const unlisten = await listen<DownloadEvent>('download', (event) => {
      let payload = event.payload
      let eventName = {
        Updated: 'onFileDownloadUpdate',
        Error: 'onFileDownloadError',
        Success: 'onFileDownloadSuccess',
        Stopped: 'onFileDownloadStopped',
        Started: 'onFileDownloadStarted',
      }[payload.event_type]

      events.emit(eventName, {
        modelId: payload.task_id,
        percent: payload.downloaded_size / payload.total_size,
        size: {
          transferred: payload.downloaded_size,
          total: payload.total_size,
        },
        downloadType: payload.download_type,
      })
    })

    try {
      await invoke<void>("download_hf_repo", { modelId, saveDir, branch, headers: this._getHeaders() })
    } catch (error) {
      console.error("Error downloading file:", error)
      events.emit('onFileDownloadError', {
        modelId: modelId,
        downloadType: 'Model',
      })
      throw error
    } finally {
      unlisten()
    }
  }

  async cancelDownload(taskId: string) {
    try {
      await invoke<void>("cancel_download_task", { taskId })
    } catch (error) {
      console.error("Error cancelling download:", error)
      throw error
    }
  }

  _getHeaders() {
    return {
      ...(this.hf_token && { Authorization: `Bearer ${this.hf_token}` })
    }
  }
}

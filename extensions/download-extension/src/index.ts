import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { BaseExtension, events } from '@janhq/core'

export enum Settings {
  hfToken = 'hf-token',
}

interface DownloadItem {
  url: string
  save_path: string
  proxy?: Record<string, string | string[] | boolean>
  sha256?: string
  size?: number
  model_id?: string
}

type DownloadEvent = {
  transferred: number
  total: number
}

// Hosts that may receive the Hugging Face access token. Sending the HF token
// to any other host (e.g. github.com) makes that host respond with HTTP 401,
// because an HF token is not a valid credential outside HF infrastructure.
// See: HF token leaked into GitHub backend downloads → 401 Unauthorized.
export const HF_AUTH_HOSTS: ReadonlyArray<string> = [
  'huggingface.co',
  'hf.co',
]

export function isHuggingFaceUrl(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase()
    return HF_AUTH_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    )
  } catch {
    return false
  }
}

// Pure variant of `_getHeaders`, exposed for unit testing. The HF access
// token is only attached when every URL in the batch targets a Hugging Face
// host. Mixed batches (HF + non-HF) drop the token to avoid leaking it to
// e.g. GitHub releases, which reject foreign credentials with 401.
export function buildAuthHeaders(
  items: ReadonlyArray<{ url: string }>,
  hfToken: string | undefined | null
): Record<string, string> {
  if (!hfToken || items.length === 0) {
    return {}
  }
  const allHuggingFace = items.every((item) => isHuggingFaceUrl(item.url))
  if (!allHuggingFace) {
    return {}
  }
  return { Authorization: `Bearer ${hfToken}` }
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
    onProgress?: (transferred: number, total: number) => void,
    resume: boolean = false
  ) {
    // relay tauri events to onProgress callback
    const unlisten = await listen<DownloadEvent>(
      `download-${taskId}`,
      (event) => {
        if (onProgress) {
          let payload = event.payload
          onProgress(payload.transferred, payload.total)
        }
      }
    )

    try {
      await invoke<void>('download_files', {
        items,
        taskId,
        headers: this._getHeaders(items),
        resume,
      })
    } catch (error) {
      console.error('Error downloading task', taskId, error)
      throw error
    } finally {
      unlisten()
    }
  }

  async cancelDownload(taskId: string) {
    try {
      await invoke<void>('cancel_download_task', { taskId })
    } catch (error) {
      console.error('Error cancelling download:', error)
      throw error
    }
  }

  _getHeaders(items: DownloadItem[]) {
    return buildAuthHeaders(items, this.hfToken)
  }
}

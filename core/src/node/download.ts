/**
 * Manages file downloads and network requests.
 */

export type DownloadProperties = {
  modelId: string
  filename: string
  time: { elapsed: number; remaining: number }
  speed: number
  percent: number
  size: { total: number; transferred: number }
}
export class DownloadManager {
  public networkRequests: Record<string, any> = {}

  public static instance: DownloadManager = new DownloadManager()

  public downloadProgressMap: Record<string, DownloadProperties> = {}

  constructor() {
    if (DownloadManager.instance) {
      return DownloadManager.instance
    }
  }
  /**
   * Sets a network request for a specific file.
   * @param {string} fileName - The name of the file.
   * @param {Request | undefined} request - The network request to set, or undefined to clear the request.
   */
  setRequest(fileName: string, request: any | undefined) {
    this.networkRequests[fileName] = request
  }
}

import { DownloadState } from '../../types'

/**
 * Manages file downloads and network requests.
 */
export class DownloadManager {
  public networkRequests: Record<string, any> = {}

  public static instance: DownloadManager = new DownloadManager()

  public downloadProgressMap: Record<string, DownloadState> = {}

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

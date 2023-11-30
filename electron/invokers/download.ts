const { ipcRenderer } = require('electron')

export function downloadInvokers() {
  const interfaces = {
    /**
     * Opens the file explorer at a specific path.
     * @param {string} path - The path to open in the file explorer.
     */
    downloadFile: (url: string, path: string) =>
      ipcRenderer.invoke('downloadFile', url, path),

    /**
     * Pauses the download of a file.
     * @param {string} fileName - The name of the file whose download should be paused.
     */
    pauseDownload: (fileName: string) =>
      ipcRenderer.invoke('pauseDownload', fileName),

    /**
     * Pauses the download of a file.
     * @param {string} fileName - The name of the file whose download should be paused.
     */
    resumeDownload: (fileName: string) =>
      ipcRenderer.invoke('resumeDownload', fileName),

    /**
     * Pauses the download of a file.
     * @param {string} fileName - The name of the file whose download should be paused.
     */
    abortDownload: (fileName: string) =>
      ipcRenderer.invoke('abortDownload', fileName),

    /**
     * Pauses the download of a file.
     * @param {string} fileName - The name of the file whose download should be paused.
     */
    onFileDownloadUpdate: (callback: any) =>
      ipcRenderer.on('FILE_DOWNLOAD_UPDATE', callback),

    /**
     * Listens for errors on file downloads.
     * @param {Function} callback - The function to call when there is an error.
     */
    onFileDownloadError: (callback: any) =>
      ipcRenderer.on('FILE_DOWNLOAD_ERROR', callback),

    /**
     * Listens for the successful completion of file downloads.
     * @param {Function} callback - The function to call when a download is complete.
     */
    onFileDownloadSuccess: (callback: any) =>
      ipcRenderer.on('FILE_DOWNLOAD_COMPLETE', callback),

    /**
     * Listens for updates on app update downloads.
     * @param {Function} callback - The function to call when there is an update.
     */
    onAppUpdateDownloadUpdate: (callback: any) =>
      ipcRenderer.on('APP_UPDATE_PROGRESS', callback),

    /**
     * Listens for errors on app update downloads.
     * @param {Function} callback - The function to call when there is an error.
     */
    onAppUpdateDownloadError: (callback: any) =>
      ipcRenderer.on('APP_UPDATE_ERROR', callback),

    /**
     * Listens for the successful completion of app update downloads.
     * @param {Function} callback - The function to call when an update download is complete.
     */
    onAppUpdateDownloadSuccess: (callback: any) =>
      ipcRenderer.on('APP_UPDATE_COMPLETE', callback),
  }

  return interfaces
}

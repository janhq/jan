import { ipcMain } from 'electron'
import { resolve, sep } from 'path'
import { WindowManager } from './../managers/window'
import request from 'request'
import { createWriteStream, renameSync } from 'fs'
import { DownloadEvent, DownloadRoute } from '@janhq/core'
const progress = require('request-progress')
import {
  DownloadManager,
  getJanDataFolderPath,
  normalizeFilePath,
} from '@janhq/core/node'

export function handleDownloaderIPCs() {
  /**
   * Handles the "pauseDownload" IPC message by pausing the download associated with the provided fileName.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle(DownloadRoute.pauseDownload, async (_event, fileName) => {
    DownloadManager.instance.networkRequests[fileName]?.pause()
  })

  /**
   * Handles the "resumeDownload" IPC message by resuming the download associated with the provided fileName.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle(DownloadRoute.resumeDownload, async (_event, fileName) => {
    DownloadManager.instance.networkRequests[fileName]?.resume()
  })

  /**
   * Handles the "abortDownload" IPC message by aborting the download associated with the provided fileName.
   * The network request associated with the fileName is then removed from the networkRequests object.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle(DownloadRoute.abortDownload, async (_event, fileName) => {
    const rq = DownloadManager.instance.networkRequests[fileName]
    if (rq) {
      DownloadManager.instance.networkRequests[fileName] = undefined
      rq?.abort()
    } else {
      WindowManager?.instance.currentWindow?.webContents.send(
        DownloadEvent.onFileDownloadError,
        {
          fileName,
          error: 'aborted',
        }
      )
    }
  })

  /**
   * Downloads a file from a given URL.
   * @param _event - The IPC event object.
   * @param url - The URL to download the file from.
   * @param fileName - The name to give the downloaded file.
   */
  ipcMain.handle(
    DownloadRoute.downloadFile,
    async (_event, url, localPath, network) => {
      const strictSSL = !network?.ignoreSSL
      const proxy = network?.proxy?.startsWith('http')
        ? network.proxy
        : undefined
      if (typeof localPath === 'string') {
        localPath = normalizeFilePath(localPath)
      }
      const array = localPath.split(sep)
      const fileName = array.pop() ?? ''
      const modelId = array.pop() ?? ''

      const destination = resolve(getJanDataFolderPath(), localPath)
      const rq = request({ url, strictSSL, proxy })

      // Put request to download manager instance
      DownloadManager.instance.setRequest(localPath, rq)

      // Downloading file to a temp file first
      const downloadingTempFile = `${destination}.download`

      progress(rq, {})
        .on('progress', function (state: any) {
          WindowManager?.instance.currentWindow?.webContents.send(
            DownloadEvent.onFileDownloadUpdate,
            {
              ...state,
              fileName,
              modelId,
            }
          )
        })
        .on('error', function (error: Error) {
          WindowManager?.instance.currentWindow?.webContents.send(
            DownloadEvent.onFileDownloadError,
            {
              fileName,
              modelId,
              error,
            }
          )
        })
        .on('end', function () {
          if (DownloadManager.instance.networkRequests[localPath]) {
            // Finished downloading, rename temp file to actual file
            renameSync(downloadingTempFile, destination)

            WindowManager?.instance.currentWindow?.webContents.send(
              DownloadEvent.onFileDownloadSuccess,
              {
                fileName,
                modelId,
              }
            )
            DownloadManager.instance.setRequest(localPath, undefined)
          } else {
            WindowManager?.instance.currentWindow?.webContents.send(
              DownloadEvent.onFileDownloadError,
              {
                fileName,
                modelId,
                error: 'aborted',
              }
            )
          }
        })
        .pipe(createWriteStream(downloadingTempFile))
    }
  )
}

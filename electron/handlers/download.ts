import { app, ipcMain } from 'electron'
import { resolve, join } from 'path'
import { WindowManager } from './../managers/window'
import request from 'request'
import { createWriteStream, renameSync } from 'fs'
import { DownloadEvent, DownloadRoute } from '@janhq/core'
const progress = require('request-progress')
import { DownloadManager } from '@janhq/core/node'

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
    DownloadManager.instance.networkRequests[fileName] = undefined
    rq?.abort()
  })

  /**
   * Downloads a file from a given URL.
   * @param _event - The IPC event object.
   * @param url - The URL to download the file from.
   * @param fileName - The name to give the downloaded file.
   */
  ipcMain.handle(DownloadRoute.downloadFile, async (_event, url, fileName) => {
    const userDataPath = join(app.getPath('home'), 'jan')
    if (
      typeof fileName === 'string' &&
      (fileName.includes('file:/') || fileName.includes('file:\\'))
    ) {
      fileName = fileName.replace('file:/', '').replace('file:\\', '')
    }
    const destination = resolve(userDataPath, fileName)
    const rq = request(url)
    // downloading file to a temp file first
    const downloadingTempFile = `${destination}.download`

    progress(rq, {})
      .on('progress', function (state: any) {
        WindowManager?.instance.currentWindow?.webContents.send(
          DownloadEvent.onFileDownloadUpdate,
          {
            ...state,
            fileName,
          }
        )
      })
      .on('error', function (err: Error) {
        WindowManager?.instance.currentWindow?.webContents.send(
          DownloadEvent.onFileDownloadError,
          {
            fileName,
            err,
          }
        )
      })
      .on('end', function () {
        if (DownloadManager.instance.networkRequests[fileName]) {
          // Finished downloading, rename temp file to actual file
          renameSync(downloadingTempFile, destination)

          WindowManager?.instance.currentWindow?.webContents.send(
            DownloadEvent.onFileDownloadSuccess,
            {
              fileName,
            }
          )
          DownloadManager.instance.setRequest(fileName, undefined)
        } else {
          WindowManager?.instance.currentWindow?.webContents.send(
            DownloadEvent.onFileDownloadError,
            {
              fileName,
              err: 'Download cancelled',
            }
          )
        }
      })
      .pipe(createWriteStream(downloadingTempFile))

    DownloadManager.instance.setRequest(fileName, rq)
  })
}

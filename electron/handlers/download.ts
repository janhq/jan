import { app, ipcMain } from 'electron'
import { DownloadManager } from './../managers/download'
import { resolve, join } from 'path'
import { WindowManager } from './../managers/window'
import request from 'request'
import { createWriteStream } from 'fs'
import { getResourcePath } from './../utils/path'
const progress = require('request-progress')

export function handleDownloaderIPCs() {
  /**
   * Handles the "pauseDownload" IPC message by pausing the download associated with the provided fileName.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle('pauseDownload', async (_event, fileName) => {
    DownloadManager.instance.networkRequests[fileName]?.pause()
  })

  /**
   * Handles the "resumeDownload" IPC message by resuming the download associated with the provided fileName.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle('resumeDownload', async (_event, fileName) => {
    DownloadManager.instance.networkRequests[fileName]?.resume()
  })

  /**
   * Handles the "abortDownload" IPC message by aborting the download associated with the provided fileName.
   * The network request associated with the fileName is then removed from the networkRequests object.
   * @param _event - The IPC event object.
   * @param fileName - The name of the file being downloaded.
   */
  ipcMain.handle('abortDownload', async (_event, fileName) => {
    const rq = DownloadManager.instance.networkRequests[fileName]
    DownloadManager.instance.networkRequests[fileName] = undefined
    rq?.abort()
  })

  ipcMain.handle('getResourcePath', async (_event) => {
    return getResourcePath()
  })

  /**
   * Downloads a file from a given URL.
   * @param _event - The IPC event object.
   * @param url - The URL to download the file from.
   * @param fileName - The name to give the downloaded file.
   */
  ipcMain.handle('downloadFile', async (_event, url, fileName) => {
    const userDataPath = join(app.getPath('home'), 'jan')
    const destination = resolve(userDataPath, fileName)
    const rq = request(url)

    progress(rq, {})
      .on('progress', function (state: any) {
        WindowManager?.instance.currentWindow?.webContents.send(
          'FILE_DOWNLOAD_UPDATE',
          {
            ...state,
            fileName,
          }
        )
      })
      .on('error', function (err: Error) {
        WindowManager?.instance.currentWindow?.webContents.send(
          'FILE_DOWNLOAD_ERROR',
          {
            fileName,
            err,
          }
        )
      })
      .on('end', function () {
        if (DownloadManager.instance.networkRequests[fileName]) {
          WindowManager?.instance.currentWindow?.webContents.send(
            'FILE_DOWNLOAD_COMPLETE',
            {
              fileName,
            }
          )
          DownloadManager.instance.setRequest(fileName, undefined)
        } else {
          WindowManager?.instance.currentWindow?.webContents.send(
            'FILE_DOWNLOAD_ERROR',
            {
              fileName,
              err: 'Download cancelled',
            }
          )
        }
      })
      .pipe(createWriteStream(destination))

    DownloadManager.instance.setRequest(fileName, rq)
  })
}

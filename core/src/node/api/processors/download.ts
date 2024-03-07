import { resolve, sep } from 'path'
import { DownloadEvent } from '../../../api'
import { normalizeFilePath } from '../../helper/path'
import { getJanDataFolderPath } from '../../helper'
import { DownloadManager } from '../../helper/download'
import { createWriteStream, renameSync } from 'fs'
import { Processor } from './Processor'
import { DownloadState } from '../../../types'

export class Downloader implements Processor {
  observer?: Function

  constructor(observer?: Function) {
    this.observer = observer
  }

  process(key: string, ...args: any[]): any {
    const instance = this as any
    const func = instance[key]
    return func(this.observer, ...args)
  }

  downloadFile(observer: any, url: string, localPath: string, network: any) {
    const request = require('request')
    const progress = require('request-progress')

    const strictSSL = !network?.ignoreSSL
    const proxy = network?.proxy?.startsWith('http') ? network.proxy : undefined
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

    // adding initial download state
    const initialDownloadState: DownloadState = {
      modelId,
      fileName,
      time: {
        elapsed: 0,
        remaining: 0,
      },
      speed: 0,
      percent: 0,
      size: {
        total: 0,
        transferred: 0,
      },
      downloadState: 'downloading',
    }
    DownloadManager.instance.downloadProgressMap[modelId] = initialDownloadState

    progress(rq, {})
      .on('progress', (state: any) => {
        const downloadState: DownloadState = {
          ...state,
          modelId,
          fileName,
          downloadState: 'downloading',
        }
        console.debug('progress: ', downloadState)
        observer?.(DownloadEvent.onFileDownloadUpdate, downloadState)
        DownloadManager.instance.downloadProgressMap[modelId] = downloadState
      })
      .on('error', (error: Error) => {
        const currentDownloadState = DownloadManager.instance.downloadProgressMap[modelId]
        const downloadState: DownloadState = {
          ...currentDownloadState,
          error: error.message,
          downloadState: 'error',
        }
        if (currentDownloadState) {
          DownloadManager.instance.downloadProgressMap[modelId] = downloadState
        }

        observer?.(DownloadEvent.onFileDownloadError, downloadState)
      })
      .on('end', () => {
        const currentDownloadState = DownloadManager.instance.downloadProgressMap[modelId]
        if (currentDownloadState && DownloadManager.instance.networkRequests[localPath]) {
          // Finished downloading, rename temp file to actual file
          renameSync(downloadingTempFile, destination)
          const downloadState: DownloadState = {
            ...currentDownloadState,
            downloadState: 'end',
          }
          observer?.(DownloadEvent.onFileDownloadSuccess, downloadState)
          DownloadManager.instance.downloadProgressMap[modelId] = downloadState
        }
      })
      .pipe(createWriteStream(downloadingTempFile))
  }

  abortDownload(observer: any, fileName: string) {
    const rq = DownloadManager.instance.networkRequests[fileName]
    if (rq) {
      DownloadManager.instance.networkRequests[fileName] = undefined
      rq?.abort()
    } else {
      observer?.(DownloadEvent.onFileDownloadError, {
        fileName,
        error: 'aborted',
      })
    }
  }

  resumeDownload(observer: any, fileName: any) {
    DownloadManager.instance.networkRequests[fileName]?.resume()
  }

  pauseDownload(observer: any, fileName: any) {
    DownloadManager.instance.networkRequests[fileName]?.pause()
  }
}

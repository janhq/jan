import { resolve, sep } from 'path'
import { DownloadEvent } from '../../../types/api'
import { normalizeFilePath } from '../../helper/path'
import { getJanDataFolderPath } from '../../helper'
import { DownloadManager } from '../../helper/download'
import { createWriteStream, renameSync } from 'fs'
import { Processor } from './Processor'
import { DownloadRequest, DownloadState, NetworkConfig } from '../../../types'

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

  downloadFile(observer: any, downloadRequest: DownloadRequest, network?: NetworkConfig) {
    const request = require('request')
    const progress = require('request-progress')

    const strictSSL = !network?.ignoreSSL
    const proxy = network?.proxy?.startsWith('http') ? network.proxy : undefined

    const { localPath, url } = downloadRequest
    let normalizedPath = localPath
    if (typeof localPath === 'string') {
      normalizedPath = normalizeFilePath(localPath)
    }
    const array = normalizedPath.split(sep)
    const fileName = array.pop() ?? ''
    const modelId = downloadRequest.modelId ?? array.pop() ?? ''

    const destination = resolve(getJanDataFolderPath(), normalizedPath)
    const rq = request({ url, strictSSL, proxy })

    // Put request to download manager instance
    DownloadManager.instance.setRequest(normalizedPath, rq)

    // Downloading file to a temp file first
    const downloadingTempFile = `${destination}.download`

    // adding initial download state
    const initialDownloadState: DownloadState = {
      modelId,
      fileName,
      percent: 0,
      size: {
        total: 0,
        transferred: 0,
      },
      children: [],
      downloadState: 'downloading',
      extensionId: downloadRequest.extensionId,
      downloadType: downloadRequest.downloadType,
      localPath: normalizedPath,
    }
    DownloadManager.instance.downloadProgressMap[modelId] = initialDownloadState
    DownloadManager.instance.downloadInfo[normalizedPath] = initialDownloadState

    if (downloadRequest.downloadType === 'extension') {
      observer?.(DownloadEvent.onFileDownloadUpdate, initialDownloadState)
    }

    progress(rq, {})
      .on('progress', (state: any) => {
        const currentDownloadState = DownloadManager.instance.downloadProgressMap[modelId]
        const downloadState: DownloadState = {
          ...currentDownloadState,
          ...state,
          fileName: fileName,
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
          fileName: fileName,
          error: error.message,
          downloadState: 'error',
        }

        observer?.(DownloadEvent.onFileDownloadError, downloadState)
        DownloadManager.instance.downloadProgressMap[modelId] = downloadState
      })
      .on('end', () => {
        const currentDownloadState = DownloadManager.instance.downloadProgressMap[modelId]
        if (
          currentDownloadState &&
          DownloadManager.instance.networkRequests[normalizedPath] &&
          DownloadManager.instance.downloadProgressMap[modelId]?.downloadState !== 'error'
        ) {
          // Finished downloading, rename temp file to actual file
          renameSync(downloadingTempFile, destination)
          const downloadState: DownloadState = {
            ...currentDownloadState,
            fileName: fileName,
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
    }

    const downloadInfo = DownloadManager.instance.downloadInfo[fileName]
    observer?.(DownloadEvent.onFileDownloadError, {
      ...downloadInfo,
      fileName,
      error: 'aborted',
    })
  }

  resumeDownload(_observer: any, fileName: any) {
    DownloadManager.instance.networkRequests[fileName]?.resume()
  }

  pauseDownload(_observer: any, fileName: any) {
    DownloadManager.instance.networkRequests[fileName]?.pause()
  }
}

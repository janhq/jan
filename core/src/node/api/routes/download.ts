import { DownloadRoute } from '../../../api'
import { join, sep } from 'path'
import { DownloadManager } from '../../download'
import { HttpServer } from '../HttpServer'
import { createWriteStream } from 'fs'
import { getJanDataFolderPath } from '../../utils'
import { normalizeFilePath } from '../../path'
import { DownloadState } from '../../../types'

export const downloadRouter = async (app: HttpServer) => {
  app.get(`/${DownloadRoute.getDownloadProgress}/:modelId`, async (req, res) => {
    const modelId = req.params.modelId

    console.debug(`Getting download progress for model ${modelId}`)
    console.debug(
      `All Download progress: ${JSON.stringify(DownloadManager.instance.downloadProgressMap)}`
    )

    // check if null DownloadManager.instance.downloadProgressMap
    if (!DownloadManager.instance.downloadProgressMap[modelId]) {
      return res.status(404).send({
        message: 'Download progress not found',
      })
    } else {
      return res.status(200).send(DownloadManager.instance.downloadProgressMap[modelId])
    }
  })

  app.post(`/${DownloadRoute.downloadFile}`, async (req, res) => {
    const strictSSL = !(req.query.ignoreSSL === 'true')
    const proxy = req.query.proxy?.startsWith('http') ? req.query.proxy : undefined
    const body = JSON.parse(req.body as any)
    const normalizedArgs = body.map((arg: any) => {
      if (typeof arg === 'string' && arg.startsWith('file:')) {
        return join(getJanDataFolderPath(), normalizeFilePath(arg))
      }
      return arg
    })

    const localPath = normalizedArgs[1]
    const array = localPath.split(sep)
    const fileName = array.pop() ?? ''
    const modelId = array.pop() ?? ''
    console.debug('downloadFile', normalizedArgs, fileName, modelId)

    const request = require('request')
    const progress = require('request-progress')

    const rq = request({ url: normalizedArgs[0], strictSSL, proxy })
    progress(rq, {})
      .on('progress', function (state: any) {
        const downloadProps: DownloadState = {
          ...state,
          modelId,
          fileName,
          downloadState: 'downloading',
        }
        console.debug(`Download ${modelId} onProgress`, downloadProps)
        DownloadManager.instance.downloadProgressMap[modelId] = downloadProps
      })
      .on('error', function (err: Error) {
        console.debug(`Download ${modelId} onError`, err.message)

        const currentDownloadState = DownloadManager.instance.downloadProgressMap[modelId]
        if (currentDownloadState) {
          DownloadManager.instance.downloadProgressMap[modelId] = {
            ...currentDownloadState,
            downloadState: 'error',
          }
        }
      })
      .on('end', function () {
        console.debug(`Download ${modelId} onEnd`)

        const currentDownloadState = DownloadManager.instance.downloadProgressMap[modelId]
        if (currentDownloadState) {
          if (currentDownloadState.downloadState === 'downloading') {
            // if the previous state is downloading, then set the state to end (success)
            DownloadManager.instance.downloadProgressMap[modelId] = {
              ...currentDownloadState,
              downloadState: 'end',
            }
          }
        }
      })
      .pipe(createWriteStream(normalizedArgs[1]))

    DownloadManager.instance.setRequest(localPath, rq)
    res.status(200).send({ message: 'Download started' })
  })

  app.post(`/${DownloadRoute.abortDownload}`, async (req, res) => {
    const body = JSON.parse(req.body as any)
    const normalizedArgs = body.map((arg: any) => {
      if (typeof arg === 'string' && arg.startsWith('file:')) {
        return join(getJanDataFolderPath(), normalizeFilePath(arg))
      }
      return arg
    })

    const localPath = normalizedArgs[0]
    const fileName = localPath.split(sep).pop() ?? ''
    const rq = DownloadManager.instance.networkRequests[fileName]
    DownloadManager.instance.networkRequests[fileName] = undefined
    rq?.abort()
    if (rq) {
      res.status(200).send({ message: 'Download aborted' })
    } else {
      res.status(404).send({ message: 'Download not found' })
    }
  })
}

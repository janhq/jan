import { DownloadRoute } from '../../../api'
import { join } from 'path'
import { DownloadManager } from '../../download'
import { HttpServer } from '../HttpServer'
import { createWriteStream } from 'fs'
import { getJanDataFolderPath } from '../../utils'
import { normalizeFilePath } from '../../path'

export const downloadRouter = async (app: HttpServer) => {
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
    const fileName = localPath.split('/').pop() ?? ''

    const request = require('request')
    const progress = require('request-progress')

    const rq = request({ url: normalizedArgs[0], strictSSL, proxy })
    progress(rq, {})
      .on('progress', function (state: any) {
        console.log('download onProgress', state)
      })
      .on('error', function (err: Error) {
        console.log('download onError', err)
      })
      .on('end', function () {
        console.log('download onEnd')
      })
      .pipe(createWriteStream(normalizedArgs[1]))

    DownloadManager.instance.setRequest(fileName, rq)
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
    const fileName = localPath.split('/').pop() ?? ''
    const rq = DownloadManager.instance.networkRequests[fileName]
    DownloadManager.instance.networkRequests[fileName] = undefined
    rq?.abort()
  })
}

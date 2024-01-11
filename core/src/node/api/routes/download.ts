import { DownloadRoute } from '../../../api'
import { join } from 'path'
import { userSpacePath } from '../../extension/manager'
import { DownloadManager } from '../../download'
import { HttpServer } from '../HttpServer'
import { createWriteStream } from 'fs'

export const downloadRouter = async (app: HttpServer) => {
  app.post(`/${DownloadRoute.downloadFile}`, async (req, res) => {
    const body = JSON.parse(req.body as any)
    const normalizedArgs = body.map((arg: any) => {
      if (typeof arg === 'string' && arg.includes('file:/')) {
        return join(userSpacePath, arg.replace('file:/', ''))
      }
      return arg
    })

    const localPath = normalizedArgs[1]
    const fileName = localPath.split('/').pop() ?? ''

    const request = require('request')
    const progress = require('request-progress')
    
    const rq = request(normalizedArgs[0])
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
      if (typeof arg === 'string' && arg.includes('file:/')) {
        return join(userSpacePath, arg.replace('file:/', ''))
      }
      return arg
    })

    const localPath = normalizedArgs[0]
    const fileName = localPath.split('/').pop() ?? ''
    console.debug('fileName', fileName)
    const rq = DownloadManager.instance.networkRequests[fileName]
    DownloadManager.instance.networkRequests[fileName] = undefined
    rq?.abort()
  })
}

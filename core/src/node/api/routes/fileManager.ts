import { FileManagerRoute } from '../../../api'
import { HttpServer } from '../../index'
import { join } from 'path'

export const fileManagerRouter = async (app: HttpServer) => {
  app.post(`/fs/${FileManagerRoute.syncFile}`, async (request: any, reply: any) => {
    const reflect = require('@alumna/reflect')
    const args = JSON.parse(request.body)
    return reflect({
      src: args[0],
      dest: args[1],
      recursive: true,
      delete: false,
      overwrite: true,
      errorOnExist: false,
    })
  })

  app.post(`/fs/${FileManagerRoute.getJanDataFolderPath}`, async (request: any, reply: any) =>
    global.core.appPath()
  )

  app.post(`/fs/${FileManagerRoute.getResourcePath}`, async (request: any, reply: any) =>
    join(global.core.appPath(), '../../..')
  )

  app.post(`/app/${FileManagerRoute.getUserHomePath}`, async (request: any, reply: any) => {})
  app.post(`/fs/${FileManagerRoute.fileStat}`, async (request: any, reply: any) => {})
}

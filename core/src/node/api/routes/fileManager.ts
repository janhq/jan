import { FileManagerRoute } from '../../../api'
import { HttpServer } from '../../index'

export const fsRouter = async (app: HttpServer) => {
  app.post(`/app/${FileManagerRoute.syncFile}`, async (request: any, reply: any) => {})

  app.post(`/app/${FileManagerRoute.getUserSpace}`, async (request: any, reply: any) => {})

  app.post(`/app/${FileManagerRoute.getResourcePath}`, async (request: any, reply: any) => {})

  app.post(`/app/${FileManagerRoute.fileStat}`, async (request: any, reply: any) => {})
}

import { HttpServer } from '../HttpServer'
import { commonRouter, threadRouter, fsRouter, extensionRouter, downloadRouter } from './index'

export const v1Router = async (app: HttpServer) => {
  // MARK: External Routes
  app.register(commonRouter)
  app.register(threadRouter, {
    prefix: '/threads',
  })

  // MARK: Internal Application Routes
  app.register(fsRouter, {
    prefix: '/fs',
  })
  app.register(extensionRouter, {
    prefix: '/extension',
  })
  app.register(downloadRouter, {
    prefix: '/download',
  })
}

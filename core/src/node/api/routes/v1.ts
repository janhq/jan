import { HttpServer } from '../HttpServer'
import { commonRouter } from './common'
import { threadRouter } from './thread'
import { fsRouter } from './fs'
import { extensionRouter } from './extension'
import { downloadRouter } from './download'

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

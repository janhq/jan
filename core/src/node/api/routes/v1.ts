import { HttpServer } from '../HttpServer'
import { commonRouter, threadRouter, fsRouter, extensionRouter, downloadRouter } from './index'

const v1Router = async (app: HttpServer) => {
  // MARK: External Routes
  app.register(commonRouter)
  app.register(threadRouter, {
    prefix: '/thread',
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
export default v1Router

import { HttpServer } from '../HttpServer'
import { commonRouter } from './common'

export const v1Router = async (app: HttpServer) => {
  // MARK: Public API Routes
  app.register(commonRouter)

  // MARK: Internal Application Routes
  // DEPRECATED: Vulnerability possible issues
  // handleRequests(app)

  // Expanded route for tracking download progress
  // TODO: Replace by Observer Wrapper (ZeroMQ / Vanilla Websocket)
  // DEPRECATED: Jan FE Docker deploy is deprecated
  // app.register(downloadRouter)
}

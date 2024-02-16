import { HttpServer } from '../HttpServer'
import { commonRouter } from './common'
import { downloadRouter } from './app/download'
import { handleRequests } from './app/handlers'

export const v1Router = async (app: HttpServer) => {
  // MARK: Public API Routes
  app.register(commonRouter)

  // MARK: Internal Application Routes
  handleRequests(app)

  // Expanded route for tracking download progress
  // TODO: Replace by Observer Wrapper (ZeroMQ / Vanilla Websocket)
  app.register(downloadRouter)
}

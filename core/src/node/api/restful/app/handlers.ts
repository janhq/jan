import { HttpServer } from '../../HttpServer'
import { Handler, RequestHandler } from '../../common/handler'

export function handleRequests(app: HttpServer) {
  const restWrapper: Handler = (route: string, listener: (...args: any[]) => any) => {
    app.post(`/app/${route}`, async (request: any, reply: any) => {
      const args = JSON.parse(request.body) as any[]
      reply.send(JSON.stringify(await listener(...args)))
    })
  }
  const handler = new RequestHandler(restWrapper)
  handler.handle()
}

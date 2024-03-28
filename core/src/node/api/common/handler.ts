import { CoreRoutes } from '../../../types/api'
import { RequestAdapter } from './adapter'

export type Handler = (route: string, args: any) => any

export class RequestHandler {
  handler: Handler
  adapter: RequestAdapter

  constructor(handler: Handler, observer?: Function) {
    this.handler = handler
    this.adapter = new RequestAdapter(observer)
  }

  handle() {
    CoreRoutes.map((route) => {
      this.handler(route, async (...args: any[]) => this.adapter.process(route, ...args))
    })
  }
}

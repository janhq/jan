import { CoreRoutes } from '../../../api'
import { RequestAdapter } from './adapter'

export type Handler = (route: string, args: any) => any

export class RequestHandler {
  handler: Handler
  adataper: RequestAdapter

  constructor(handler: Handler, observer?: Function) {
    this.handler = handler
    this.adataper = new RequestAdapter(observer)
  }

  handle() {
    CoreRoutes.map((route) => {
      this.handler(route, async (...args: any[]) => {
        const values = await this.adataper.process(route, ...args)
        return values
      })
    })
  }
}

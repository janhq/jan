import { HttpServer } from '../HttpServer'
import {
  chatCompletions,
  deleteBuilder,
  downloadModel,
  getBuilder,
  retrieveBuilder,
} from '../common/builder'

import { JanApiRouteConfiguration } from '../common/configuration'

export const commonRouter = async (app: HttpServer) => {
  Object.keys(JanApiRouteConfiguration).forEach((key) => {
    app.get(`/${key}`, async (_request) => getBuilder(JanApiRouteConfiguration[key]))

    app.get(`/${key}/:id`, async (request: any) =>
      retrieveBuilder(JanApiRouteConfiguration[key], request.params.id),
    )

    app.delete(`/${key}/:id`, async (request: any) =>
      deleteBuilder(JanApiRouteConfiguration[key], request.params.id),
    )
  })

  app.get(`/models/download/:modelId`, async (request: any) =>
    downloadModel(request.params.modelId),
  )

  // Endpoints
  app.post(`/chat/completions`, async (request: any, reply: any) => chatCompletions(request, reply))
}

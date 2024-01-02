import { AppRoute } from '../../../api'
import { HttpServer } from '../HttpServer'
import { basename, join } from 'path'
import {
  chatCompletions,
  deleteBuilder,
  downloadModel,
  getBuilder,
  retrieveBuilder,
} from '../common/builder'

import { JanApiRouteConfiguration } from '../common/configuration'

export const commonRouter = async (app: HttpServer) => {
  // Common Routes
  Object.keys(JanApiRouteConfiguration).forEach((key) => {
    app.get(`/${key}`, async (_request) => getBuilder(JanApiRouteConfiguration[key]))

    app.get(`/${key}/:id`, async (request: any) =>
      retrieveBuilder(JanApiRouteConfiguration[key], request.params.id),
    )

    app.delete(`/${key}/:id`, async (request: any) =>
      deleteBuilder(JanApiRouteConfiguration[key], request.params.id),
    )
  })

  // Download Model Routes
  app.get(`/models/download/:modelId`, async (request: any) =>
    downloadModel(request.params.modelId),
  )

  // Chat Completion Routes
  app.post(`/chat/completions`, async (request: any, reply: any) => chatCompletions(request, reply))

  // App Routes
  app.post(`/app/${AppRoute.joinPath}`, async (request: any, reply: any) => {
    const args = JSON.parse(request.body) as any[]
    reply.send(JSON.stringify(join(...args[0])))
  })

  app.post(`/app/${AppRoute.baseName}`, async (request: any, reply: any) => {
    const args = JSON.parse(request.body) as any[]
    reply.send(JSON.stringify(basename(args[0])))
  })
}

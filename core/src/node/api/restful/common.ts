import { HttpServer } from '../HttpServer'
import {
  chatCompletions,
  downloadModel,
  getBuilder,
  retrieveBuilder,
  createMessage,
  createThread,
  getMessages,
  retrieveMessage,
  updateThread,
  models,
} from './helper/builder'

import { JanApiRouteConfiguration } from './helper/configuration'

export const commonRouter = async (app: HttpServer) => {
  const normalizeData = (data: any) => {
    return {
      object: 'list',
      data,
    }
  }
  // Common Routes
  // Read & Delete :: Threads | Models | Assistants
  Object.keys(JanApiRouteConfiguration).forEach((key) => {
    app.get(`/${key}`, async (_req, _res) => {
      if (key.includes('models')) {
        return models(_req, _res)
      }
      return getBuilder(JanApiRouteConfiguration[key]).then(normalizeData)
    })

    app.get(`/${key}/:id`, async (_req: any, _res: any) => {
      if (key.includes('models')) {
        return models(_req, _res)
      }
      return retrieveBuilder(JanApiRouteConfiguration[key], _req.params.id)
    })

    app.delete(`/${key}/:id`, async (_req: any, _res: any) => {
      if (key.includes('models')) {
        return models(_req, _res)
      }
      return retrieveBuilder(JanApiRouteConfiguration[key], _req.params.id)
    })
  })

  // Threads
  app.post(`/threads`, async (req, res) => createThread(req.body))

  app.get(`/threads/:threadId/messages`, async (req, res) =>
    getMessages(req.params.threadId).then(normalizeData)
  )

  app.get(`/threads/:threadId/messages/:messageId`, async (req, res) =>
    retrieveMessage(req.params.threadId, req.params.messageId)
  )

  app.post(`/threads/:threadId/messages`, async (req, res) =>
    createMessage(req.params.threadId as any, req.body as any)
  )

  app.patch(`/threads/:threadId`, async (request: any) =>
    updateThread(request.params.threadId, request.body)
  )

  // Models
  app.get(`/models/download/:modelId`, async (request: any) =>
    downloadModel(request.params.modelId, {
      ignoreSSL: request.query.ignoreSSL === 'true',
      proxy: request.query.proxy,
    })
  )

  app.post(`/models/start`, async (request: any, reply: any) => models(request, reply))

  app.post(`/models/stop`, async (request: any, reply: any) => models(request, reply))

  // Chat Completion
  app.post(`/chat/completions`, async (request: any, reply: any) => chatCompletions(request, reply))
}

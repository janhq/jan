import { HttpServer } from '../HttpServer'
import {
  chatCompletions,
  deleteBuilder,
  downloadModel,
  getBuilder,
  retrieveBuilder,
  createMessage,
  createThread,
  getMessages,
  retrieveMessage,
  updateThread,
} from './helper/builder'

import { JanApiRouteConfiguration } from './helper/configuration'
import { startModel, stopModel } from './helper/startStopModel'
import { ModelSettingParams } from '../../../types'

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
    app.get(`/${key}`, async (_request) =>
      getBuilder(JanApiRouteConfiguration[key]).then(normalizeData)
    )

    app.get(`/${key}/:id`, async (request: any) =>
      retrieveBuilder(JanApiRouteConfiguration[key], request.params.id)
    )

    app.delete(`/${key}/:id`, async (request: any) =>
      deleteBuilder(JanApiRouteConfiguration[key], request.params.id)
    )
  })

  // Threads
  app.post(`/threads/`, async (req, res) => createThread(req.body))

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

  app.put(`/models/:modelId/start`, async (request: any) => {
    let settingParams: ModelSettingParams | undefined = undefined
    if (Object.keys(request.body).length !== 0) {
      settingParams = JSON.parse(request.body) as ModelSettingParams
    }

    return startModel(request.params.modelId, settingParams)
  })

  app.put(`/models/:modelId/stop`, async (request: any) => stopModel(request.params.modelId))

  // Chat Completion
  app.post(`/chat/completions`, async (request: any, reply: any) => chatCompletions(request, reply))
}

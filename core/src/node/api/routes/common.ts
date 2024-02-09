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
import { startModel, stopModel } from '../common/startStopModel'
import { ModelSettingParams } from '../../../types'
import { getJanDataFolderPath } from '../../utils'
import { normalizeFilePath } from '../../path'

export const commonRouter = async (app: HttpServer) => {
  // Common Routes
  Object.keys(JanApiRouteConfiguration).forEach((key) => {
    app.get(`/${key}`, async (_request) => getBuilder(JanApiRouteConfiguration[key]))

    app.get(`/${key}/:id`, async (request: any) =>
      retrieveBuilder(JanApiRouteConfiguration[key], request.params.id)
    )

    app.delete(`/${key}/:id`, async (request: any) =>
      deleteBuilder(JanApiRouteConfiguration[key], request.params.id)
    )
  })

  // Download Model Routes
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

  // Chat Completion Routes
  app.post(`/chat/completions`, async (request: any, reply: any) => chatCompletions(request, reply))

  // App Routes
  app.post(`/app/${AppRoute.joinPath}`, async (request: any, reply: any) => {
    const args = JSON.parse(request.body) as any[]

    const paths = args[0].map((arg: string) =>
      typeof arg === 'string' && (arg.startsWith(`file:/`) || arg.startsWith(`file:\\`))
        ? join(getJanDataFolderPath(), normalizeFilePath(arg))
        : arg
    )

    reply.send(JSON.stringify(join(...paths)))
  })

  app.post(`/app/${AppRoute.baseName}`, async (request: any, reply: any) => {
    const args = JSON.parse(request.body) as any[]
    reply.send(JSON.stringify(basename(args[0])))
  })
}

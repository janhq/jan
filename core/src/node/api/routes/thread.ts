import { HttpServer } from '../HttpServer'
import {
  createMessage,
  createThread,
  getMessages,
  retrieveMesasge,
  updateThread,
} from '../common/builder'

export const threadRouter = async (app: HttpServer) => {
  // create thread
  app.post(`/`, async (req, res) => createThread(req.body))

  app.get(`/:threadId/messages`, async (req, res) => getMessages(req.params.threadId))

  // retrieve message
  app.get(`/:threadId/messages/:messageId`, async (req, res) =>
    retrieveMesasge(req.params.threadId, req.params.messageId),
  )

  // create message
  app.post(`/:threadId/messages`, async (req, res) =>
    createMessage(req.params.threadId as any, req.body as any),
  )

  // modify thread
  app.patch(`/:threadId`, async (request: any) =>
    updateThread(request.params.threadId, request.body),
  )
}

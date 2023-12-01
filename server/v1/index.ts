import assistantsAPI from './assistants'
import chatCompletionAPI from './chat'
import modelsAPI from './models'
import threadsAPI from './threads'

import { FastifyInstance, FastifyPluginAsync } from 'fastify'

const router: FastifyPluginAsync = async (app: FastifyInstance, opts) => {
    app.register(
        assistantsAPI,
        {
            prefix: "/assisstants"
        }
    )

    app.register(
        chatCompletionAPI,
        {
            prefix: "/chat/completion"
        }
    )

    app.register(
        modelsAPI,
        {
            prefix: "/models"
        }
    )

    app.register(
        threadsAPI,
        {
            prefix: "/threads"
        }
    )
}
export default router;
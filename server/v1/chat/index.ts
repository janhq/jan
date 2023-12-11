import { FastifyInstance, FastifyPluginAsync, FastifyPluginOptions } from 'fastify'

const router: FastifyPluginAsync = async (app: FastifyInstance, opts: FastifyPluginOptions) => {
    //TODO: Add controllers for here
    // app.get("/", controller)

    app.post("/", (req, res) => {
        req.body
    })
}
export default router;
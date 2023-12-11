import { RouteHandlerMethod, FastifyRequest, FastifyReply } from 'fastify'
import { MODEL_FOLDER_PATH } from "./index"
import fs from 'fs/promises'

const controller: RouteHandlerMethod = async (req: FastifyRequest, res: FastifyReply) => {
    //TODO: download models impl
    //Mirror logic from JanModelExtension.downloadModel? 
    let model = req.body.model;

    // Fetching logic
    // const directoryPath = join(MODEL_FOLDER_PATH, model.id)
    // await fs.mkdir(directoryPath)

    // const path = join(directoryPath, model.id)
    // downloadFile(model.source_url, path)
    // TODO: Different model downloader from different model vendor

    res.status(200).send({
        status: "Ok"
    })
}

export default controller;
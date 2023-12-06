
export const MODEL_FOLDER_PATH = "./data/models"
export const _modelMetadataFileName = 'model.json'

import fs from 'fs/promises'
import { Model } from '@janhq/core'
import { join } from 'path'

// map string => model object 
let modelIndex = new Map<String, Model>();
async function buildModelIndex(){
    let modelIds = await fs.readdir(MODEL_FOLDER_PATH);
    // TODO: read modelFolders to get model info, mirror JanModelExtension?
    try{
        for(let modelId in modelIds){
            let path = join(MODEL_FOLDER_PATH, modelId)
            let fileData = await fs.readFile(join(path, _modelMetadataFileName))
            modelIndex.set(modelId, JSON.parse(fileData.toString("utf-8")) as Model)
        }
    }
    catch(err){
        console.error("build model index failed. ", err);
    }
}
buildModelIndex()

import { FastifyInstance, FastifyPluginAsync, FastifyPluginOptions } from 'fastify'
import downloadModelController from './downloadModel'
import { startModel, stopModel } from './modelOp'

const router: FastifyPluginAsync = async (app: FastifyInstance, opts: FastifyPluginOptions) => {
    //TODO: Add controllers declaration here

    ///////////// CRUD ////////////////
    // Model listing
    app.get("/", async (req, res) => {
        res.status(200).send(
            modelIndex.values()
        )
    })

    // Retrieve model info
    app.get("/:id", (req, res) => {
        res.status(200).send(
            modelIndex.get(req.params.id)
        )
    })

    // Delete model 
    app.delete("/:id", (req, res) => {
        modelIndex.delete(req.params)

        // TODO: delete on disk 
    })

    ///////////// Other ops ////////////////
    app.post("/", downloadModelController)
    app.put("/start", startModel)
    app.put("/stop", stopModel)
}
export default router;
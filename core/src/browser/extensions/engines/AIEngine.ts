import { getJanDataFolderPath, joinPath } from '../../core'
import { events } from '../../events'
import { BaseExtension } from '../../extension'
import { fs } from '../../fs'
import { MessageRequest, Model, ModelEvent } from '../../../types'
import { EngineManager } from './EngineManager'

/**
 * Base AIEngine
 * Applicable to all AI Engines
 */
export abstract class AIEngine extends BaseExtension {
  // The inference engine
  abstract provider: string

  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    this.registerEngine()

    events.on(ModelEvent.OnModelInit, (model: Model) => this.loadModel(model))
    events.on(ModelEvent.OnModelStop, (model: Model) => this.unloadModel(model))

    this.prePopulateModels()
  }

  /**
   * Defines models
   */
  models(): Promise<Model[]> {
    return Promise.resolve([])
  }

  /**
   * Registers AI Engines
   */
  registerEngine() {
    EngineManager.instance()?.register(this)
  }

  /**
   * Loads the model.
   */
  async loadModel(model: Model): Promise<any> {
    if (model.engine.toString() !== this.provider) return Promise.resolve()
    events.emit(ModelEvent.OnModelReady, model)
    return Promise.resolve()
  }
  /**
   * Stops the model.
   */
  async unloadModel(model?: Model): Promise<any> {
    if (model?.engine && model.engine.toString() !== this.provider) return Promise.resolve()
    events.emit(ModelEvent.OnModelStopped, model ?? {})
    return Promise.resolve()
  }

  /*
   * Inference request
   */
  inference(data: MessageRequest) {}

  /**
   * Stop inference
   */
  stopInference() {}

  /**
   * Pre-populate models to App Data Folder
   */
  prePopulateModels(): Promise<void> {
    const modelFolder = 'models'
    return this.models().then((models) => {
      const prePoluateOperations = models.map((model) =>
        getJanDataFolderPath()
          .then((janDataFolder) =>
            // Attempt to create the model folder
            joinPath([janDataFolder, modelFolder, model.id]).then((path) =>
              fs
                .mkdir(path)
                .catch()
                .then(() => path)
            )
          )
          .then((path) => joinPath([path, 'model.json']))
          .then((path) => {
            // Do not overwite existing model.json
            return fs.existsSync(path).then((exist: any) => {
              if (!exist) return fs.writeFileSync(path, JSON.stringify(model, null, 2))
            })
          })
          .catch((e: Error) => {
            console.error('Error', e)
          })
      )
      Promise.all(prePoluateOperations).then(() =>
        // Emit event to update models
        // So the UI can update the models list
        events.emit(ModelEvent.OnModelsUpdate, {})
      )
    })
  }
}

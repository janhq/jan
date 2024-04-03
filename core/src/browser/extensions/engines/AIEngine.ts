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
  }

  /**
   * Defines models
   */
  async models(): Promise<Model[]> {
    return []
  }

  /**
   * Registers AI Engines
   */
  registerEngine() {
    EngineManager.instance().register(this)
  }

  async registerModels(models: Model[]): Promise<void> {
    const modelFolder = 'models'
    const modelFolderPath = await joinPath([await getJanDataFolderPath(), modelFolder])

    let shouldNotifyModelUpdate = false
    for (const model of models) {
      const modelPath = await joinPath([modelFolderPath, model.id])
      const isExist = await fs.existsSync(modelPath)

      // Skip if the model folder already exists
      if (isExist) continue

      await fs.mkdir(modelPath)
      await fs.writeFileSync(
        await joinPath([modelPath, 'model.json']),
        JSON.stringify(model, null, 2)
      )
      shouldNotifyModelUpdate = true
    }

    if (shouldNotifyModelUpdate) {
      events.emit(ModelEvent.OnModelsUpdate, {})
    }
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
}

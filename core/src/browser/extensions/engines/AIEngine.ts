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
  private static modelsFolder = 'models'

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
   * Registers AI Engines
   */
  registerEngine() {
    EngineManager.instance().register(this)
  }

  async registerModels(models: Model[]): Promise<void> {
    const modelFolderPath = await joinPath([await getJanDataFolderPath(), AIEngine.modelsFolder])

    let shouldNotifyModelUpdate = false
    for (const model of models) {
      const modelPath = await joinPath([modelFolderPath, model.id])
      const isExist = await fs.existsSync(modelPath)

      if (isExist) {
        await this.migrateModelIfNeeded(model, modelPath)
        continue
      }

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

  async migrateModelIfNeeded(model: Model, modelPath: string): Promise<void> {
    try {
      const modelJson = await fs.readFileSync(await joinPath([modelPath, 'model.json']), 'utf-8')
      const currentModel: Model = JSON.parse(modelJson)
      if (currentModel.version !== model.version) {
        await fs.writeFileSync(
          await joinPath([modelPath, 'model.json']),
          JSON.stringify(model, null, 2)
        )

        events.emit(ModelEvent.OnModelsUpdate, {})
      }
    } catch (error) {
      console.warn('Error while try to migrating model', error)
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

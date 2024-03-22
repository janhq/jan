import { executeOnMain, getJanDataFolderPath, joinPath, systemInformation } from '../../core'
import { events } from '../../events'
import { Model, ModelEvent } from '../../types'
import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Local Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class LocalOAIEngine extends OAIEngine {
  // The inference engine
  abstract nodeModule: string
  loadModelFunctionName: string = 'loadModel'
  unloadModelFunctionName: string = 'unloadModel'

  /**
   * On extension load, subscribe to events.
   */
  onLoad() {
    super.onLoad()
    // These events are applicable to local inference providers
    events.on(ModelEvent.OnModelInit, (model: Model) => this.loadModel(model))
    events.on(ModelEvent.OnModelStop, (model: Model) => this.unloadModel(model))
  }

  /**
   * Load the model.
   */
  async loadModel(model: Model) {
    if (model.engine.toString() !== this.provider) return

    const modelFolder = await joinPath([await getJanDataFolderPath(), this.modelFolder, model.id])
    const systemInfo = await systemInformation()
    const res = await executeOnMain(
      this.nodeModule,
      this.loadModelFunctionName,
      {
        modelFolder,
        model,
      },
      systemInfo
    )

    if (res?.error) {
      events.emit(ModelEvent.OnModelFail, {
        ...model,
        error: res.error,
      })
      return
    } else {
      this.loadedModel = model
      events.emit(ModelEvent.OnModelReady, model)
    }
  }
  /**
   * Stops the model.
   */
  unloadModel(model: Model) {
    if (model.engine && model.engine?.toString() !== this.provider) return
    this.loadedModel = undefined

    executeOnMain(this.nodeModule, this.unloadModelFunctionName).then(() => {
      events.emit(ModelEvent.OnModelStopped, {})
    })
  }
}

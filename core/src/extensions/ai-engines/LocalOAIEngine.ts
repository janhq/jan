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
  loadModelFunctionName: string = 'loadModel'
  unloadModelFunctionName: string = 'unloadModel'
  isRunning: boolean = false

  /**
   * On extension load, subscribe to events.
   */
  onLoad() {
    super.onLoad()
    // These events are applicable to local inference providers
    events.on(ModelEvent.OnModelInit, (model: Model) => this.onModelInit(model))
    events.on(ModelEvent.OnModelStop, (model: Model) => this.onModelStop(model))
  }

  /**
   * Load the model.
   */
  async onModelInit(model: Model) {
    if (model.engine.toString() !== this.provider) return

    const modelFolder = await joinPath([await getJanDataFolderPath(), this.modelFolder, model.id])
    const systemInfo = await systemInformation()
    const res = await executeOnMain(this.nodeModule, this.loadModelFunctionName, {
      modelFolder,
      model,
    }, systemInfo)

    if (res?.error) {
      events.emit(ModelEvent.OnModelFail, {
        ...model,
        error: res.error,
      })
      return
    } else {
      this.loadedModel = model
      events.emit(ModelEvent.OnModelReady, model)
      this.isRunning = true
    }
  }
  /**
   * Stops the model.
   */
  onModelStop(model: Model) {
    if (model.engine?.toString() !== this.provider) return

    this.isRunning = false

    executeOnMain(this.nodeModule, this.unloadModelFunctionName).then(() => {
      events.emit(ModelEvent.OnModelStopped, {})
    })
  }
}

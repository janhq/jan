import { executeOnMain, getJanDataFolderPath, joinPath, systemInformation } from '../../core'
import { events } from '../../events'
import { Model, ModelEvent } from '../../../types'
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

  override async onLoad(): Promise<void> {}

  override async onUnload(): Promise<void> {}

  /**
   * Load the model.
   */
  override async loadModel(model: Model): Promise<void> {
    const modelFolderName = 'models'
    const modelFolder = await joinPath([await getJanDataFolderPath(), modelFolderName, model.id])
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
      throw new Error(res.error)
    } else {
      this.loadedModel = model
    }
  }

  /**
   * Stops the model.
   */
  override async unloadModel(model?: Model): Promise<void> {
    try {
      await executeOnMain(this.nodeModule, this.unloadModelFunctionName)
      this.loadedModel = undefined
      events.emit(ModelEvent.OnModelStopped, {})
    } catch (err) {
      console.error(`Error unloading model: ${err}`)
    } finally {
      this.loadedModel = undefined
      events.emit(ModelEvent.OnModelStopped, {})
    }
  }
}

import { events } from '../../events'
import { Model, ModelEvent } from '../../../types'
import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Local Inference Provider
 * 
 * This abstract class extends OAIEngine and provides the implementation of loading 
 * and unloading models, which is applicable to local inference providers.
 */
export abstract class LocalOAIEngine extends OAIEngine {
  /**
   * The inference engine module name
   */
  abstract nodeModule: string

  /**
   * The name of the function used to load models
   * @default 'loadModel'
   */
  loadModelFunctionName: string = 'loadModel'

  /**
   * The name of the function used to unload models
   * @default 'unloadModel'
   */
  unloadModelFunctionName: string = 'unloadModel'

  /**
   * Initializes the local OAI engine by setting up event listeners.
   * 
   * This method subscribes to ModelEvent.OnModelInit for loading models when initiated
   * and ModelEvent.OnModelStop for unloading models when stopped. These events are
   * specifically applicable to local inference providers.
   */
  override onLoad() {
    super.onLoad()
    // These events are applicable to local inference providers
    events.on(ModelEvent.OnModelInit, (model: Model) => this.loadModel(model))
    events.on(ModelEvent.OnModelStop, (model: Model) => this.unloadModel(model))
  }

  /**
   * Loads the specified model for inference.
   * 
   * @param model - The model to load, optionally including a file path
   * @returns A promise that resolves when the model is loaded
   */
  async loadModel(model: Model & { file_path?: string }): Promise<void> {
    // Implementation of loading the model
  }

  /**
   * Unloads the specified model to free up resources.
   * 
   * @param model - The model to unload (optional)
   * @returns A promise that resolves when the model is unloaded
   */
  async unloadModel(model?: Model) {
    // Implementation of unloading the model
  }
}

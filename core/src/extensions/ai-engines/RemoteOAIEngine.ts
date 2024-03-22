import { events } from '../../events'
import { Model, ModelEvent } from '../../types'
import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Remote Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class RemoteOAIEngine extends OAIEngine {
  // The inference engine
  abstract apiKey: string
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
    events.emit(ModelEvent.OnModelReady, model)
  }
  /**
   * Stops the model.
   */
  unloadModel(model: Model) {
    if (model.engine && model.engine.toString() !== this.provider) return
    events.emit(ModelEvent.OnModelStopped, {})
  }

  /**
   * Headers for the inference request
   */
  override headers(): HeadersInit {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'api-key': `${this.apiKey}`,
    }
  }
}

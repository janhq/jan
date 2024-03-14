import { events } from '../../events'
import { Model, ModelEvent } from '../../types'
import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Remote Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class RemoteOAIEngine extends OAIEngine {
  // The inference engine

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
    events.emit(ModelEvent.OnModelReady, model)
  }
  /**
   * Stops the model.
   */
  onModelStop(model: Model) {
    if (model.engine.toString() !== this.provider) return
    events.emit(ModelEvent.OnModelStopped, {})
  }

  /**
   * Headers for the inference request
   */
  override headers(): HeadersInit {
    return {}
  }
}

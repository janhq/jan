import { events } from '../../events'
import { BaseExtension } from '../../extension'
import { MessageRequest, Model, ModelEvent } from '../../../types'
import { EngineManager } from './EngineManager'
import { ModelManager } from '../../models/manager'

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
   * Registers AI Engines
   */
  registerEngine() {
    EngineManager.instance().register(this)
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

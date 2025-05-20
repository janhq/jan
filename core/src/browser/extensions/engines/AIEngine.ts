import { events } from '../../events'
import { BaseExtension } from '../../extension'
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
  }

  /**
   * Registers AI Engines
   */
  registerEngine() {
    EngineManager.instance().register(this)
  }
}

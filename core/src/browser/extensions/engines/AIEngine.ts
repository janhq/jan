import { BaseExtension } from '../../extension'
import { EngineManager } from './EngineManager'

/**
 * Base AIEngine
 * Applicable to all AI Engines
 */

export abstract class AIEngine extends BaseExtension {
  // The inference engine ID, implementing the readonly providerId from interface
  abstract readonly provider: string

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

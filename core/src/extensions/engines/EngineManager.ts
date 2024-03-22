import { log } from '../../core'
import { AIEngine } from './AIEngine'

/**
 * Manages the registration and retrieval of inference engines.
 */
export class EngineManager {
  public engines = new Map<string, AIEngine>()

  /**
   * Registers an engine.
   * @param engine - The engine to register.
   */
  register<T extends AIEngine>(engine: T) {
    this.engines.set(engine.provider, engine)
  }

  /**
   * Retrieves a engine by provider.
   * @param provider - The name of the engine to retrieve.
   * @returns The engine, if found.
   */
  get<T extends AIEngine>(provider: string): T | undefined {
    return this.engines.get(provider) as T | undefined
  }

  static instance(): EngineManager | undefined {
    return window.core?.engineManager as EngineManager
  }
}

/**
 * The singleton instance of the ExtensionManager.
 */

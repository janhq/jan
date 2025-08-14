import { AIEngine } from './AIEngine'

/**
 * Manages the registration and retrieval of inference engines.
 */
export class EngineManager {
  /**
   * Map storing registered engines by their provider name.
   */
  public engines = new Map<string, AIEngine>()
  
  /**
   * Abort controller for managing cancellation of operations.
   */
  public controller: AbortController | null = null

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

  /**
   * The instance of the engine manager.
   * @returns The singleton instance of EngineManager.
   */
  static instance(): EngineManager {
    return (window.core?.engineManager as EngineManager) ?? new EngineManager()
  }
}

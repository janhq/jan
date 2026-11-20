import { toDisposable, type Disposable } from '@janhq/extension-api'
import { AIEngine } from './AIEngine'

/**
 * Manages the registration and retrieval of inference engines.
 */
export class EngineManager {
  public engines = new Map<string, AIEngine>()
  public controller: AbortController | null = null

  /**
   * Registers an engine under its provider until the result is disposed.
   * @param engine - The engine to register.
   */
  register<T extends AIEngine>(engine: T): Disposable {
    this.engines.set(engine.provider, engine)
    return toDisposable(() => {
      // A newer engine may have taken the provider since.
      if (this.engines.get(engine.provider) === engine) this.engines.delete(engine.provider)
    })
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
   */
  static instance(): EngineManager {
    return (window.core?.engineManager as EngineManager) ?? new EngineManager()
  }
}

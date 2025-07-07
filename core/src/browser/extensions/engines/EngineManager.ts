import { AIEngine } from './AIEngine'
import { InferenceEngine } from '../../../types/engine'

/**
 * Manages the registration and retrieval of inference engines.
 */
export class EngineManager {
  public engines = new Map<string, AIEngine>()
  public controller: AbortController | null = null

  // Mapping of legacy engine names to the cortex engine for migration purposes
  private cortexEngineAliases = [
    InferenceEngine.nitro,
    InferenceEngine.cortex_llamacpp,
    InferenceEngine.cortex_onnx,
    InferenceEngine.cortex_tensorrtllm,
  ]

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
    // Check if this is a legacy engine name that should map to cortex
    if (this.cortexEngineAliases.includes(provider as InferenceEngine)) {
      return this.engines.get(InferenceEngine.cortex) as T | undefined
    }

    return this.engines.get(provider) as T | undefined
  }

  /**
   * The instance of the engine manager.
   */
  static instance(): EngineManager {
    return (window.core?.engineManager as EngineManager) ?? new EngineManager()
  }
}

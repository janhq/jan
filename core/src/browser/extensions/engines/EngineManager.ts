import { InferenceEngine } from '../../../types'
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
    // Backward compatible provider
    // nitro is migrated to cortex
    if (
      [
        InferenceEngine.nitro,
        InferenceEngine.cortex,
        InferenceEngine.cortex_llamacpp,
        InferenceEngine.cortex_onnx,
        InferenceEngine.cortex_tensorrtllm,
        InferenceEngine.cortex_onnx,
      ]
        .map((e) => e.toString())
        .includes(provider)
    )
      provider = InferenceEngine.cortex

    return this.engines.get(provider) as T | undefined
  }

  /**
   * The instance of the engine manager.
   */
  static instance(): EngineManager {
    return (window.core?.engineManager as EngineManager) ?? new EngineManager()
  }
}

import { AIEngine } from './AIEngine'
import {
  modelInfo,
  SessionInfo,
  UnloadResult,
  chatCompletionRequest,
  chatCompletion,
  chatCompletionChunk,
  ImportOptions,
} from './LocalAIEngineTypes'
/**
 * Base AI Local Inference Provider
 */
export abstract class LocalAIEngine extends AIEngine {
  /**
   * This class represents a base for local inference providers in the OpenAI architecture.
   * It extends the AIEngine class and provides the implementation of loading and unloading models locally.
   */

  override async onLoad(): Promise<void> {
    super.onLoad() // ensures registration happens
  }

  /*
   * For any clean ups before extension shutdown
   */
  abstract onUnload(): Promise<void>

  /**
   * Gets model info
   * @param modelId
   */
  abstract get(modelId: string): Promise<modelInfo | undefined>

  /**
   * Lists available models
   */
  abstract list(): Promise<modelInfo[]>

  /**
   * Loads a model into memory
   */
  abstract load(modelId: string, settings?: any): Promise<SessionInfo>

  /**
   * Unloads a model from memory
   */
  abstract unload(sessionId: string): Promise<UnloadResult>

  /**
   * Sends a chat request to the model
   */
  abstract chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>>

  /**
   * Deletes a model
   */
  abstract delete(modelId: string): Promise<void>

  /**
   * Updates a model
   */
  abstract update(modelId: string, model: Partial<modelInfo>): Promise<void>
  /**
   * Imports a model
   */
  abstract import(modelId: string, opts: ImportOptions): Promise<void>

  /**
   * Aborts an ongoing model import
   */
  abstract abortImport(modelId: string): Promise<void>

  /**
   * Get currently loaded models
   */
  abstract getLoadedModels(): Promise<string[]>

  /**
   * Check if a tool is supported by the model
   * @param modelId
   */
  abstract isToolSupported(modelId: string): Promise<boolean>
}

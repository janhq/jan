/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module llamacpp-extension/src/index
 */

import {
  AIEngine,
  getJanDataFolderPath,
  fs,
  Model,
} from '@janhq/core'

import { invoke } from '@tauri-apps/api/tauri'
import {
  LocalProvider,
  ModelInfo,
  ListOptions,
  ListResult,
  PullOptions,
  PullResult,
  LoadOptions,
  SessionInfo,
  UnloadOptions,
  UnloadResult,
  ChatOptions,
  ChatCompletion,
  ChatCompletionChunk,
  DeleteOptions,
  DeleteResult,
  ImportOptions,
  ImportResult,
  AbortPullOptions,
  AbortPullResult,
  ChatCompletionRequest,
} from './types'

/**
 * Helper to convert GGUF model filename to a more structured ID/name
 * Example: "mistral-7b-instruct-v0.2.Q4_K_M.gguf" -> { baseModelId: "mistral-7b-instruct-v0.2", quant: "Q4_K_M" }
 **/
function parseGGUFFileName(filename: string): {
  baseModelId: string
  quant?: string
} {
  const nameWithoutExt = filename.replace(/\.gguf$/i, '')
  // Try to split by common quantization patterns (e.g., .Q4_K_M, -IQ2_XS)
  const match = nameWithoutExt.match(
    /^(.*?)[-_]([QqIiFf]\w{1,3}_\w{1,3}|[Qq]\d+_[KkSsMmXxLl\d]+|[IiQq]\d+_[XxSsMm]+|[Qq]\d+)$/
  )
  if (match && match[1] && match[2]) {
    return { baseModelId: match[1], quant: match[2] }
  }
  return { baseModelId: nameWithoutExt }
}

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class inference_llamacpp_extension
  extends AIEngine
  implements LocalProvider
{
  provider: string = 'llamacpp'
  readonly providerId: string = 'llamcpp'

  private activeSessions: Map<string, SessionInfo> = new Map()

  private modelsBasePath!: string

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine
    this.registerSettings(SETTINGS_DEFINITIONS)

    const customPath = await this.getSetting<string>(
      LlamaCppSettings.ModelsPath,
      ''
    )
    if (customPath && (await fs.exists(customPath))) {
      this.modelsBasePath = customPath
    } else {
      this.modelsBasePath = await path.join(
        await getJanDataFolderPath(),
        'models',
        ENGINE_ID
      )
    }
    await fs.createDirAll(this.modelsBasePath)

    console.log(
      `${this.providerId} provider loaded. Models path: ${this.modelsBasePath}`
    )

    // Optionally, list and register models with the core system if AIEngine expects it
    // const models = await this.listModels({ providerId: this.providerId });
    // this.registerModels(this.mapModelInfoToCoreModel(models)); // mapModelInfoToCoreModel would be a helper
  }

  async getModelsPath(): Promise<string> {
    // Ensure modelsBasePath is initialized
    if (!this.modelsBasePath) {
      const customPath = await this.getSetting<string>(
        LlamaCppSettings.ModelsPath,
        ''
      )
      if (customPath && (await fs.exists(customPath))) {
        this.modelsBasePath = customPath
      } else {
        this.modelsBasePath = await path.join(
          await getJanDataFolderPath(),
          'models',
          ENGINE_ID
        )
      }
      await fs.createDirAll(this.modelsBasePath)
    }
    return this.modelsBasePath
  }

  async listModels(_opts: ListOptions): Promise<ListResult> {
    const modelsDir = await this.getModelsPath()
    const result: ModelInfo[] = []

    try {
      if (!(await fs.exists(modelsDir))) {
        await fs.createDirAll(modelsDir)
        return []
      }

      const entries = await fs.readDir(modelsDir)
      for (const entry of entries) {
        if (entry.name?.endsWith('.gguf') && entry.isFile) {
          const modelPath = await path.join(modelsDir, entry.name)
          const stats = await fs.stat(modelPath)
          const parsedName = parseGGUFFileName(entry.name)

          result.push({
            id: `${parsedName.baseModelId}${parsedName.quant ? `/${parsedName.quant}` : ''}`, // e.g., "mistral-7b/Q4_0"
            name: entry.name.replace('.gguf', ''), // Or a more human-friendly name
            quant_type: parsedName.quant,
            providerId: this.providerId,
            sizeBytes: stats.size,
            path: modelPath,
            tags: [this.providerId, parsedName.quant || 'unknown_quant'].filter(
              Boolean
            ) as string[],
          })
        }
      }
    } catch (error) {
      console.error(`[${this.providerId}] Error listing models:`, error)
      // Depending on desired behavior, either throw or return empty/partial list
    }
    return result
  }

  // pullModel
  async pullModel(opts: PullOptions): Promise<PullResult> {
    // TODO: Implement pullModel
    return 0;
  }

  // abortPull
  async abortPull(opts: AbortPullOptions): Promise<AbortPullResult> {
    // TODO: implement abortPull
  }

  async load(opts: LoadOptions): Promise<SessionInfo> {
    if (opts.providerId !== this.providerId) {
      throw new Error('Invalid providerId for LlamaCppProvider.loadModel')
    }

    const sessionId = uuidv4()
    const loadParams = {
      model_path: opts.modelPath,
      session_id: sessionId, // Pass sessionId to Rust for tracking
      // Default llama.cpp server options, can be overridden by opts.options
      port: opts.options?.port ?? 0, // 0 for dynamic port assignment by OS
      n_gpu_layers:
        opts.options?.n_gpu_layers ??
        (await this.getSetting(LlamaCppSettings.DefaultNGpuLayers, -1)),
      n_ctx:
        opts.options?.n_ctx ??
        (await this.getSetting(LlamaCppSettings.DefaultNContext, 2048)),
      // Spread any other options from opts.options
      ...(opts.options || {}),
    }

    try {
      console.log(
        `[${this.providerId}] Requesting to load model: ${opts.modelPath} with options:`,
        loadParams
      )
      // This matches the Rust handler: core::utils::extensions::inference_llamacpp_extension::server::load
      const rustResponse: {
        session_id: string
        port: number
        model_path: string
        settings: Record<string, unknown>
      } = await invoke('plugin:llamacpp|load', { params: loadParams }) // Adjust namespace if needed

      if (!rustResponse || !rustResponse.port) {
        throw new Error(
          'Rust load function did not return expected port or session info.'
        )
      }

      const sessionInfo: SessionInfo = {
        sessionId: rustResponse.session_id, // Use sessionId from Rust if it regenerates/confirms it
        port: rustResponse.port,
        modelPath: rustResponse.model_path,
        providerId: this.providerId,
        settings: rustResponse.settings, // Settings actually used by the server
      }

      this.activeSessions.set(sessionInfo.sessionId, sessionInfo)
      console.log(
        `[${this.providerId}] Model loaded: ${sessionInfo.modelPath} on port ${sessionInfo.port}, session: ${sessionInfo.sessionId}`
      )
      return sessionInfo
    } catch (error) {
      console.error(
        `[${this.providerId}] Error loading model ${opts.modelPath}:`,
        error
      )
      throw error // Re-throw to be handled by the caller
    }
  }

  async unload(opts: UnloadOptions): Promise<UnloadResult> {
    if (opts.providerId !== this.providerId) {
      return { success: false, error: 'Invalid providerId' }
    }
    const session = this.activeSessions.get(opts.sessionId)
    if (!session) {
      return {
        success: false,
        error: `No active session found for id: ${opts.sessionId}`,
      }
    }

    try {
      console.log(
        `[${this.providerId}] Requesting to unload model for session: ${opts.sessionId}`
      )
      // Matches: core::utils::extensions::inference_llamacpp_extension::server::unload
      const rustResponse: { success: boolean; error?: string } = await invoke(
        'plugin:llamacpp|unload',
        { sessionId: opts.sessionId }
      )

      if (rustResponse.success) {
        this.activeSessions.delete(opts.sessionId)
        console.log(
          `[${this.providerId}] Session ${opts.sessionId} unloaded successfully.`
        )
        return { success: true }
      } else {
        console.error(
          `[${this.providerId}] Failed to unload session ${opts.sessionId}: ${rustResponse.error}`
        )
        return {
          success: false,
          error: rustResponse.error || 'Unknown error during unload',
        }
      }
    } catch (error: any) {
      console.error(
        `[${this.providerId}] Error invoking unload for session ${opts.sessionId}:`,
        error
      )
      return { success: false, error: error.message || String(error) }
    }
  }

  async chat(
    opts: ChatOptions
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {}

  async deleteModel(opts: DeleteOptions): Promise<DeleteResult> {}

  async importModel(opts: ImportOptions): Promise<ImportResult> {}

  override async loadModel(model: Model): Promise<any> {
    if (model.engine?.toString() !== this.provider) return Promise.resolve()
    console.log(
      `[${this.providerId} AIEngine] Received OnModelInit for:`,
      model.id
    )
    return super.load(model)
  }

  override async unloadModel(model?: Model): Promise<any> {
    if (model?.engine && model.engine.toString() !== this.provider)
      return Promise.resolve()
    console.log(
      `[${this.providerId} AIEngine] Received OnModelStop for:`,
      model?.id || 'all models'
    )
    return super.unload(model)
  }
}

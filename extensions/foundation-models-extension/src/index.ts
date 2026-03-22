/**
 * Apple Foundation Models Extension
 *
 * Provides access to Apple's on-device Foundation Models (macOS 26+ with Apple
 * Intelligence) as a Jan AI engine. The model runs fully locally — no internet
 * connection or external API key is required.
 *
 * Architecture:
 *   Jan extension (TypeScript) → Tauri plugin (Rust / fm-rs) → FoundationModels.framework
 *
 * The Tauri plugin calls Apple's FoundationModels framework directly via Rust
 * FFI bindings (fm-rs), eliminating the need for a separate HTTP server process.
 */

import {
  AIEngine,
  EngineManager,
  modelInfo,
  SessionInfo,
  UnloadResult,
  chatCompletion,
  chatCompletionChunk,
  ImportOptions,
  chatCompletionRequest,
} from '@janhq/core'

import { info, warn, error as logError } from '@tauri-apps/plugin-log'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  loadFoundationModels,
  unloadFoundationModels,
  isFoundationModelsLoaded,
  foundationModelsChatCompletion,
  foundationModelsChatCompletionStream,
  abortFoundationModelsStream,
  checkFoundationModelsAvailability,
} from '@janhq/tauri-plugin-foundation-models-api'

// ─── Constants ───────────────────────────────────────────────────────────────

const APPLE_MODEL_ID = 'apple/on-device'
const APPLE_MODEL_NAME = 'Apple On-Device Model'

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = {
  info: (...args: any[]) => {
    console.log(...args)
    info(args.map(String).join(' '))
  },
  warn: (...args: any[]) => {
    console.warn(...args)
    warn(args.map(String).join(' '))
  },
  error: (...args: any[]) => {
    console.error(...args)
    logError(args.map(String).join(' '))
  },
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default class FoundationModelsExtension extends AIEngine {
  readonly provider: string = 'foundation-models'
  readonly providerId: string = 'foundation-models'

  timeout: number = 300

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override async onLoad(): Promise<void> {
    super.onLoad()

    try {
      const availability = await checkFoundationModelsAvailability()
      if (availability !== 'available') {
        logger.warn(
          `Foundation Models not available on this device (status: ${availability}). ` +
          'Hiding provider.'
        )
        EngineManager.instance().engines.delete(this.provider)
      }
    } catch (err) {
      logger.warn('Could not determine Foundation Models availability — hiding provider.', err)
      EngineManager.instance().engines.delete(this.provider)
    }
  }

  override async onUnload(): Promise<void> {
    // Cleanup handled by the Tauri plugin on app exit.
  }

  // ── Model catalogue ────────────────────────────────────────────────────────

  override async list(): Promise<modelInfo[]> {
    return [this.buildModelInfo()]
  }

  override async get(modelId: string): Promise<modelInfo | undefined> {
    if (modelId !== APPLE_MODEL_ID) return undefined
    return this.buildModelInfo()
  }

  private buildModelInfo(): modelInfo {
    return {
      id: APPLE_MODEL_ID,
      name: APPLE_MODEL_NAME,
      providerId: this.provider,
      port: 0,
      sizeBytes: 0,
      tags: ['on-device', 'apple-intelligence'],
      capabilities: ['tools'],
    }
  }

  // ── Session management ─────────────────────────────────────────────────────

  override async load(
    modelId: string,
    _overrideSettings?: any,
    _isEmbedding: boolean = false,
    _bypassAutoUnload: boolean = false
  ): Promise<SessionInfo> {
    if (modelId !== APPLE_MODEL_ID) {
      throw new Error(
        `Foundation Models extension only supports model '${APPLE_MODEL_ID}', got '${modelId}'`
      )
    }

    const alreadyLoaded = await isFoundationModelsLoaded()
    if (alreadyLoaded) {
      logger.info('Foundation Models already loaded')
      return this.toSessionInfo(modelId)
    }

    logger.info('Loading Foundation Models...')

    try {
      await loadFoundationModels(modelId)
      logger.info('Foundation Models loaded successfully')
      return this.toSessionInfo(modelId)
    } catch (err) {
      logger.error('Failed to load Foundation Models:', err)
      throw err
    }
  }

  override async unload(_modelId: string): Promise<UnloadResult> {
    try {
      await unloadFoundationModels()
      logger.info('Foundation Models unloaded successfully')
      return { success: true }
    } catch (err) {
      logger.error('Error unloading Foundation Models:', err)
      return { success: false, error: String(err) }
    }
  }

  // ── Inference ──────────────────────────────────────────────────────────────

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const loaded = await isFoundationModelsLoaded()
    if (!loaded) {
      throw new Error(
        'Apple Foundation Model is not loaded. Please load the model first.'
      )
    }

    const body = JSON.stringify(opts)

    if (opts.stream) {
      return this.handleStreamingChat(body, abortController)
    }

    const result = await foundationModelsChatCompletion(body)
    return JSON.parse(result) as chatCompletion
  }

  private async *handleStreamingChat(
    body: string,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    const requestId = crypto.randomUUID()
    const chunks: chatCompletionChunk[] = []
    let done = false
    let streamError: Error | null = null
    let resolver: (() => void) | null = null

    const unlisten: UnlistenFn = await listen(
      `foundation-models-stream-${requestId}`,
      (event) => {
        const payload = event.payload as {
          data?: string
          done?: boolean
          error?: string
        }
        if (payload.done) {
          done = true
          resolver?.()
        } else if (payload.error) {
          streamError = new Error(payload.error)
          resolver?.()
        } else if (payload.data) {
          try {
            chunks.push(JSON.parse(payload.data) as chatCompletionChunk)
          } catch (e) {
            logger.error('Error parsing Foundation Models stream JSON:', e)
          }
          resolver?.()
        }
      }
    )

    foundationModelsChatCompletionStream(body, requestId).catch((err) => {
      streamError =
        err instanceof Error ? err : new Error(String(err))
      resolver?.()
    })

    if (abortController?.signal) {
      const onAbort = () => {
        abortFoundationModelsStream(requestId).catch(() => {})
      }
      if (abortController.signal.aborted) {
        onAbort()
      } else {
        abortController.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    try {
      while (!done) {
        if (streamError) throw streamError

        while (chunks.length > 0) {
          yield chunks.shift()!
        }

        if (done) break
        if (streamError) throw streamError

        await new Promise<void>((r) => {
          resolver = r
        })
      }

      while (chunks.length > 0) {
        yield chunks.shift()!
      }
    } finally {
      unlisten()
    }
  }

  // ── Unsupported operations ─────────────────────────────────────────────────

  override async delete(_modelId: string): Promise<void> {
    throw new Error(
      'Apple Foundation Models are part of the operating system and cannot be deleted from Jan.'
    )
  }

  override async update(_modelId: string, _model: Partial<modelInfo>): Promise<void> {
    throw new Error(
      'Apple Foundation Models are managed by the OS and cannot be updated from Jan.'
    )
  }

  override async import(_modelId: string, _opts: ImportOptions): Promise<void> {
    throw new Error(
      'Apple Foundation Models are built into the OS — there is nothing to import.'
    )
  }

  override async abortImport(_modelId: string): Promise<void> {
    // No download to abort — the model is managed by the OS.
  }

  override async getLoadedModels(): Promise<string[]> {
    const loaded = await isFoundationModelsLoaded()
    return loaded ? [APPLE_MODEL_ID] : []
  }

  override async isToolSupported(_modelId: string): Promise<boolean> {
    return true
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toSessionInfo(modelId: string): SessionInfo {
    return {
      pid: 0,
      port: 0,
      model_id: modelId,
      model_path: '',
      is_embedding: false,
      api_key: '',
    }
  }
}

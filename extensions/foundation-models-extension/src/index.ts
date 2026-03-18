/**
 * Apple Foundation Models Extension
 *
 * Provides access to Apple's on-device Foundation Models (macOS 26+ with Apple
 * Intelligence) as a Jan AI engine. The model runs fully locally — no internet
 * connection or external API key is required.
 *
 * Architecture:
 *   Jan extension (TypeScript) → Tauri plugin (Rust) → foundation-models-server (Swift)
 *                                                         ↓
 *                                             Apple FoundationModels.framework
 *
 * The extension spawns a lightweight OpenAI-compatible HTTP server (`foundation-models-server`)
 * that wraps the system Foundation Models API. Chat requests are proxied through that
 * local server, keeping the same pattern used by the MLX and llama.cpp engines.
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
import { invoke } from '@tauri-apps/api/core'
import {
  loadFoundationModelsServer,
  unloadFoundationModelsServer,
  isFoundationModelsProcessRunning,
  getFoundationModelsRandomPort,
  findFoundationModelsSession,
  checkFoundationModelsAvailability,
} from '@janhq/tauri-plugin-foundation-models-api'

// ─── Constants ───────────────────────────────────────────────────────────────

/** The stable model ID used throughout Jan for the Apple on-device model. */
const APPLE_MODEL_ID = 'apple/on-device'

/** Display name shown in the Jan UI. */
const APPLE_MODEL_NAME = 'Apple On-Device Model'

/** Shared API secret used to authorise requests to the local server. */
const API_SECRET = 'JanFoundationModels'

/** Seconds to wait for the server binary to become ready. */
const SERVER_STARTUP_TIMEOUT = 60

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

  /** Seconds before a streaming request is considered timed out. */
  timeout: number = 300

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override async onLoad(): Promise<void> {
    super.onLoad() // registers into EngineManager

    // Check device eligibility and silently remove ourselves if not supported.
    // This prevents the provider from appearing in the UI on ineligible devices.
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
    // Clean-up is handled by the Tauri plugin on app exit.
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

    // Return existing session if already running
    const existing = await findFoundationModelsSession()
    if (existing) {
      logger.info('Foundation Models server already running on port', existing.port)
      return this.toSessionInfo(existing)
    }

    const port = await getFoundationModelsRandomPort()
    const apiKey = await this.generateApiKey(port)

    logger.info('Starting Foundation Models server on port', port)

    try {
      const session = await loadFoundationModelsServer(
        APPLE_MODEL_ID,
        port,
        apiKey,
        SERVER_STARTUP_TIMEOUT
      )
      logger.info('Foundation Models server started, PID', session.pid)
      return this.toSessionInfo(session)
    } catch (err) {
      logger.error('Failed to start Foundation Models server:', err)
      throw err
    }
  }

  override async unload(modelId: string): Promise<UnloadResult> {
    const session = await findFoundationModelsSession()
    if (!session) {
      logger.warn('No active Foundation Models session to unload')
      return { success: false, error: 'No active session found' }
    }

    try {
      const result = await unloadFoundationModelsServer(session.pid)
      if (result.success) {
        logger.info('Foundation Models server unloaded successfully')
      } else {
        logger.warn('Failed to unload Foundation Models server:', result.error)
      }
      return result
    } catch (err) {
      logger.error('Error unloading Foundation Models server:', err)
      return { success: false, error: String(err) }
    }
  }

  // ── Inference ──────────────────────────────────────────────────────────────

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const session = await findFoundationModelsSession()
    if (!session) {
      throw new Error(
        'Apple Foundation Model is not loaded. Please load the model first.'
      )
    }

    // Verify the server process is still alive
    const alive = await isFoundationModelsProcessRunning(session.pid)
    if (!alive) {
      throw new Error(
        'Apple Foundation Model server has crashed. Please reload the model.'
      )
    }

    // Health check
    try {
      await fetch(`http://localhost:${session.port}/health`)
    } catch {
      throw new Error(
        'Apple Foundation Model server is not responding. Please reload the model.'
      )
    }

    const url = `http://localhost:${session.port}/v1/chat/completions`
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.api_key}`,
    }
    const body = JSON.stringify(opts)

    if (opts.stream) {
      return this.handleStreamingResponse(url, headers, body, abortController)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: abortController?.signal,
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => null)
      throw new Error(
        `Foundation Models API request failed (${response.status}): ${JSON.stringify(errData)}`
      )
    }

    return (await response.json()) as chatCompletion
  }

  private async *handleStreamingResponse(
    url: string,
    headers: HeadersInit,
    body: string,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    const combinedController = new AbortController()
    const timeoutId = setTimeout(
      () => combinedController.abort(new Error('Request timed out')),
      this.timeout * 1000
    )

    if (abortController?.signal) {
      if (abortController.signal.aborted) {
        combinedController.abort(abortController.signal.reason)
      } else {
        abortController.signal.addEventListener(
          'abort',
          () => combinedController.abort(abortController.signal.reason),
          { once: true }
        )
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: combinedController.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!response.ok) {
      const errData = await response.json().catch(() => null)
      throw new Error(
        `Foundation Models streaming request failed (${response.status}): ${JSON.stringify(errData)}`
      )
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6)) as chatCompletionChunk
              yield data
            } catch (e) {
              logger.error('Error parsing Foundation Models stream JSON:', e)
              throw e
            }
          } else if (trimmed.startsWith('error: ')) {
            const errObj = JSON.parse(trimmed.slice(7))
            throw new Error(errObj.message ?? 'Unknown streaming error')
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ── Unsupported operations ─────────────────────────────────────────────────
  // Foundation Models are built into the OS — there are no files to manage.

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
    const session = await findFoundationModelsSession()
    return session ? [APPLE_MODEL_ID] : []
  }

  override async isToolSupported(_modelId: string): Promise<boolean> {
    // The Foundation Models framework supports function calling.
    return true
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Derive a per-session API key from the shared secret and port number.
   * Uses the same HMAC-SHA256 approach as the llamacpp extension so the
   * Tauri `generate_api_key` command can be reused.
   */
  private async generateApiKey(port: number): Promise<string> {
    return invoke<string>('plugin:llamacpp|generate_api_key', {
      modelId: APPLE_MODEL_ID + port,
      apiSecret: API_SECRET,
    })
  }

  /**
   * Map the plugin SessionInfo shape to the core SessionInfo shape.
   */
  private toSessionInfo(session: {
    pid: number
    port: number
    model_id: string
    api_key: string
  }): SessionInfo {
    return {
      pid: session.pid,
      port: session.port,
      model_id: session.model_id,
      model_path: '',
      is_embedding: false,
      api_key: session.api_key,
    }
  }
}

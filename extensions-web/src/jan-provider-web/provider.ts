/**
 * Jan Provider Extension for Web
 * Provides remote model inference through Jan API
 */

import {
  AIEngine,
  modelInfo,
  SessionInfo,
  UnloadResult,
  chatCompletionRequest,
  chatCompletion,
  chatCompletionChunk,
  ImportOptions,
} from '@janhq/core' // cspell: disable-line
import { janApiClient, JanChatMessage } from './api'
import { syncJanModelsLocalStorage } from './helpers'
import { janProviderStore } from './store'
import { ApiError } from '../shared/types/errors'

export default class JanProviderWeb extends AIEngine {
  readonly provider = 'jan'
  private activeSessions: Map<string, SessionInfo> = new Map()

  override async onLoad() {
    console.log('Loading Jan Provider Extension...')

    try {
      // Initialize authentication
      await janApiClient.initialize()
      // Check and sync stored Jan models against latest catalog data
      await this.validateJanModelsLocalStorage()

      console.log('Jan Provider Extension loaded successfully')
    } catch (error) {
      console.error('Failed to load Jan Provider Extension:', error)
      throw error
    }

    super.onLoad()
  }

  // Verify Jan models capabilities in localStorage
  private async validateJanModelsLocalStorage(): Promise<void> {
    try {
      console.log('Validating Jan models in localStorage...')

      const remoteModels = await janApiClient.getModels()
      const storageUpdated = syncJanModelsLocalStorage(remoteModels)

      if (storageUpdated) {
        console.log(
          'Synchronized Jan models in localStorage with server capabilities; reloading...'
        )
        window.location.reload()
      }
    } catch (error) {
      console.error('Failed to check Jan models:', error)
    }
  }

  override async onUnload() {
    console.log('Unloading Jan Provider Extension...')

    // Clear all sessions
    for (const sessionId of this.activeSessions.keys()) {
      await this.unload(sessionId)
    }

    janProviderStore.reset()
    console.log('Jan Provider Extension unloaded')
  }

  async get(modelId: string): Promise<modelInfo | undefined> {
    return janApiClient
      .getModels()
      .then((list) => list.find((e) => e.id === modelId))
      .then((model) =>
        model
          ? {
              id: model.id,
              name: model.id, // Use ID as name for now
              quant_type: undefined,
              providerId: this.provider,
              port: 443, // HTTPS port for API
              sizeBytes: 0, // Size not provided by Jan API
              tags: [],
              path: undefined, // Remote model, no local path
              owned_by: model.owned_by,
              object: model.object,
              capabilities: [...model.capabilities],
            }
          : undefined
      )
  }

  async list(): Promise<modelInfo[]> {
    try {
      const janModels = await janApiClient.getModels()

      return janModels.map((model) => ({
        id: model.id,
        name: model.id, // Use ID as name for now
        quant_type: undefined,
        providerId: this.provider,
        port: 443, // HTTPS port for API
        sizeBytes: 0, // Size not provided by Jan API
        tags: [],
        path: undefined, // Remote model, no local path
        owned_by: model.owned_by,
        object: model.object,
        capabilities: [...model.capabilities],
      }))
    } catch (error) {
      console.error('Failed to list Jan models:', error)
      throw error
    }
  }

  async load(modelId: string, _settings?: any): Promise<SessionInfo> {
    try {
      // For Jan API, we don't actually "load" models in the traditional sense
      // We just create a session reference for tracking
      const sessionId = `jan-${modelId}-${Date.now()}`

      const sessionInfo: SessionInfo = {
        pid: Date.now(), // Use timestamp as pseudo-PID
        port: 443, // HTTPS port
        model_id: modelId,
        model_path: `remote:${modelId}`, // Indicate this is a remote model
        is_embedding: false, // assume false here, TODO: might need further implementation
        api_key: '', // API key handled by auth service
      }

      this.activeSessions.set(sessionId, sessionInfo)

      console.log(
        `Jan model session created: ${sessionId} for model ${modelId}`
      )
      return sessionInfo
    } catch (error) {
      console.error(`Failed to load Jan model ${modelId}:`, error)
      throw error
    }
  }

  async unload(sessionId: string): Promise<UnloadResult> {
    try {
      const session = this.activeSessions.get(sessionId)

      if (!session) {
        return {
          success: false,
          error: `Session ${sessionId} not found`,
        }
      }

      this.activeSessions.delete(sessionId)
      console.log(`Jan model session unloaded: ${sessionId}`)

      return { success: true }
    } catch (error) {
      console.error(`Failed to unload Jan session ${sessionId}:`, error)
      return {
        success: false,
        error:
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error',
      }
    }
  }

  async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    try {
      // Check if request was aborted before starting
      if (abortController?.signal?.aborted) {
        throw new Error('Request was aborted')
      }

      // For Jan API, we need to determine which model to use
      // The model should be specified in opts.model
      const modelId = opts.model
      if (!modelId) {
        throw new Error('Model ID is required')
      }

      // Convert core chat completion request to Jan API format
      const janMessages: JanChatMessage[] = opts.messages.map((msg) => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      }))

      const janRequest = {
        model: modelId,
        messages: janMessages,
        conversation_id: opts.thread_id,
        temperature: opts.temperature ?? undefined,
        max_tokens: opts.n_predict ?? undefined,
        top_p: opts.top_p ?? undefined,
        frequency_penalty: opts.frequency_penalty ?? undefined,
        presence_penalty: opts.presence_penalty ?? undefined,
        stream: opts.stream ?? false,
        stop: opts.stop ?? undefined,
        tools: opts.tools ?? undefined,
        tool_choice: opts.tool_choice ?? undefined,
      }

      if (opts.stream) {
        // Return async generator for streaming
        return this.createStreamingGenerator(janRequest, abortController)
      } else {
        // Return single response
        const response = await janApiClient.createChatCompletion(janRequest)

        // Check if aborted after completion
        if (abortController?.signal?.aborted) {
          throw new Error('Request was aborted')
        }

        return {
          id: response.id,
          object: 'chat.completion' as const,
          created: response.created,
          model: response.model,
          choices: response.choices.map((choice) => ({
            index: choice.index,
            message: {
              role: choice.message.role,
              content: choice.message.content,
              reasoning: choice.message.reasoning,
              reasoning_content: choice.message.reasoning_content,
              tool_calls: choice.message.tool_calls,
            },
            finish_reason: (choice.finish_reason || 'stop') as
              | 'stop'
              | 'length'
              | 'tool_calls'
              | 'content_filter'
              | 'function_call',
          })),
          usage: response.usage,
        }
      }
    } catch (error) {
      console.error('Jan chat completion failed:', error)
      throw error
    }
  }

  private async *createStreamingGenerator(
    janRequest: any,
    abortController?: AbortController
  ) {
    let resolve: () => void
    let reject: (error: Error) => void
    const chunks: any[] = []
    let isComplete = false
    let error: Error | null = null

    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    // Handle abort signal
    const abortListener = () => {
      error = new Error('Request was aborted')
      reject(error)
    }

    if (abortController?.signal) {
      if (abortController.signal.aborted) {
        throw new Error('Request was aborted')
      }
      abortController.signal.addEventListener('abort', abortListener)
    }

    try {
      // Start the streaming request
      janApiClient.createStreamingChatCompletion(
        janRequest,
        (chunk) => {
          if (abortController?.signal?.aborted) {
            return
          }
          const streamChunk = {
            id: chunk.id,
            object: chunk.object,
            created: chunk.created,
            model: chunk.model,
            choices: chunk.choices.map((choice) => ({
              index: choice.index,
              delta: {
                role: choice.delta.role,
                content: choice.delta.content,
                reasoning: choice.delta.reasoning,
                reasoning_content: choice.delta.reasoning_content,
                tool_calls: choice.delta.tool_calls,
              },
              finish_reason: choice.finish_reason,
            })),
          }
          chunks.push(streamChunk)
        },
        () => {
          isComplete = true
          resolve()
        },
        (err) => {
          error = err
          reject(err)
        }
      )

      // Yield chunks as they arrive
      let yieldedIndex = 0
      while (!isComplete && !error) {
        if (abortController?.signal?.aborted) {
          throw new Error('Request was aborted')
        }

        while (yieldedIndex < chunks.length) {
          yield chunks[yieldedIndex]
          yieldedIndex++
        }

        // Wait a bit before checking again
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // Yield any remaining chunks
      while (yieldedIndex < chunks.length) {
        yield chunks[yieldedIndex]
        yieldedIndex++
      }

      if (error) {
        throw error
      }

      await promise
    } finally {
      // Clean up abort listener
      if (abortController?.signal) {
        abortController.signal.removeEventListener('abort', abortListener)
      }
    }
  }

  async delete(modelId: string): Promise<void> {
    throw new Error(
      `Delete operation not supported for remote Jan API model: ${modelId}`
    )
  }

  async update(modelId: string, model: Partial<modelInfo>): Promise<void> {
    throw new Error(
      `Update operation not supported for remote Jan API model: ${modelId}`
    )
  }

  async import(modelId: string, _opts: ImportOptions): Promise<void> {
    throw new Error(
      `Import operation not supported for remote Jan API model: ${modelId}`
    )
  }

  async abortImport(modelId: string): Promise<void> {
    throw new Error(
      `Abort import operation not supported for remote Jan API model: ${modelId}`
    )
  }

  async getLoadedModels(): Promise<string[]> {
    return Array.from(this.activeSessions.values()).map(
      (session) => session.model_id
    )
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    // Jan models support tool calls via MCP
    console.log(`Checking tool support for Jan model ${modelId}: supported`)
    return true
  }
}

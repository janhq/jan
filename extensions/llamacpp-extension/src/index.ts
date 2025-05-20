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
  joinPath,
  modelInfo,
  listOptions,
  listResult,
  pullOptions,
  pullResult,
  loadOptions,
  sessionInfo,
  unloadOptions,
  unloadResult,
  chatOptions,
  chatCompletion,
  chatCompletionChunk,
  deleteOptions,
  deleteResult,
  importOptions,
  importResult,
  abortPullOptions,
  abortPullResult,
  chatCompletionRequest,
} from '@janhq/core'

import { invoke } from '@tauri-apps/api/tauri'

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
export default class llamacpp_extension extends AIEngine {
  provider: string = 'llamacpp'
  readonly providerId: string = 'llamacpp'

  private activeSessions: Map<string, sessionInfo> = new Map()
  private modelsBasePath!: string
  private activeRequests: Map<string, AbortController> = new Map()

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine
    this.registerSettings(SETTINGS)

    // Initialize models base path - assuming this would be retrieved from settings
    this.modelsBasePath = await joinPath([
      await getJanDataFolderPath(),
      'models',
    ])
  }

  // Implement the required LocalProvider interface methods
  override async list(opts: listOptions): Promise<listResult> {
    throw new Error('method not implemented yet')
  }

  override async pull(opts: pullOptions): Promise<pullResult> {
    throw new Error('method not implemented yet')
  }

  override async load(opts: loadOptions): Promise<sessionInfo> {
    const args: string[] = []

    // disable llama-server webui
    args.push('--no-webui')

    // model option is required
    args.push('-m', opts.modelPath)
    args.push('--port', String(opts.port || 8080)) // Default port if not specified

    if (opts.n_gpu_layers === undefined) {
      // in case of CPU only build, this option will be ignored
      args.push('-ngl', '99')
    } else {
      args.push('-ngl', String(opts.n_gpu_layers))
    }

    if (opts.n_ctx !== undefined) {
      args.push('-c', String(opts.n_ctx))
    }

    // Add remaining options from the interface
    if (opts.threads !== undefined) {
      args.push('--threads', String(opts.threads))
    }

    if (opts.threads_batch !== undefined) {
      args.push('--threads-batch', String(opts.threads_batch))
    }

    if (opts.ctx_size !== undefined) {
      args.push('--ctx-size', String(opts.ctx_size))
    }

    if (opts.n_predict !== undefined) {
      args.push('--n-predict', String(opts.n_predict))
    }

    if (opts.batch_size !== undefined) {
      args.push('--batch-size', String(opts.batch_size))
    }

    if (opts.ubatch_size !== undefined) {
      args.push('--ubatch-size', String(opts.ubatch_size))
    }

    if (opts.device !== undefined) {
      args.push('--device', opts.device)
    }

    if (opts.split_mode !== undefined) {
      args.push('--split-mode', opts.split_mode)
    }

    if (opts.main_gpu !== undefined) {
      args.push('--main-gpu', String(opts.main_gpu))
    }

    // Boolean flags
    if (opts.flash_attn === true) {
      args.push('--flash-attn')
    }

    if (opts.cont_batching === true) {
      args.push('--cont-batching')
    }

    if (opts.no_mmap === true) {
      args.push('--no-mmap')
    }

    if (opts.mlock === true) {
      args.push('--mlock')
    }

    if (opts.no_kv_offload === true) {
      args.push('--no-kv-offload')
    }

    if (opts.cache_type_k !== undefined) {
      args.push('--cache-type-k', opts.cache_type_k)
    }

    if (opts.cache_type_v !== undefined) {
      args.push('--cache-type-v', opts.cache_type_v)
    }

    if (opts.defrag_thold !== undefined) {
      args.push('--defrag-thold', String(opts.defrag_thold))
    }

    if (opts.rope_scaling !== undefined) {
      args.push('--rope-scaling', opts.rope_scaling)
    }

    if (opts.rope_scale !== undefined) {
      args.push('--rope-scale', String(opts.rope_scale))
    }

    if (opts.rope_freq_base !== undefined) {
      args.push('--rope-freq-base', String(opts.rope_freq_base))
    }

    if (opts.rope_freq_scale !== undefined) {
      args.push('--rope-freq-scale', String(opts.rope_freq_scale))
    }
    console.log('Calling Tauri command load with args:', args)

    try {
      const sInfo = await invoke<sessionInfo>('load_llama_model', {
        args: args,
      })

      // Store the session info for later use
      this.activeSessions.set(sInfo.sessionId, sInfo)

      return sInfo
    } catch (error) {
      console.error('Error loading llama-server:', error)
      throw new Error(`Failed to load llama-server: ${error}`)
    }
  }

  override async unload(opts: unloadOptions): Promise<unloadResult> {
    try {
      // Pass the PID as the session_id
      const result = await invoke<unloadResult>('unload_llama_model', {
        session_id: opts.sessionId, // Using PID as session ID
      })

      // If successful, remove from active sessions
      if (result.success) {
        this.activeSessions.delete(opts.sessionId)
        console.log(`Successfully unloaded model with PID ${opts.sessionId}`)
      } else {
        console.warn(`Failed to unload model: ${result.error}`)
      }

      return result
    } catch (error) {
      console.error('Error in unload command:', error)
      return {
        success: false,
        error: `Failed to unload model: ${error}`,
      }
    }
  }

  private async *handleStreamingResponse(
    url: string,
    headers: HeadersInit,
    body: string
  ): AsyncIterable<chatCompletionChunk> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
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

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines in the buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep the last incomplete line in the buffer

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || trimmedLine === 'data: [DONE]') {
            continue
          }

          if (trimmedLine.startsWith('data: ')) {
            const jsonStr = trimmedLine.slice(6)
            try {
              const chunk = JSON.parse(jsonStr) as chatCompletionChunk
              yield chunk
            } catch (e) {
              console.error('Error parsing JSON from stream:', e)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private findSessionByModel(modelName: string): sessionInfo | undefined {
    for (const [, session] of this.activeSessions) {
      if (session.modelName === modelName) {
        return session
      }
    }
    return undefined
  }

  override async chat(
    opts: chatCompletionRequest
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const sessionInfo = this.findSessionByModel(opts.model)
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }
    const baseUrl = `http://localhost:${sessionInfo.port}/v1`
    const url = `${baseUrl}/chat/completions`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer test-k`,
    }

    const body = JSON.stringify(opts)
    if (opts.stream) {
      return this.handleStreamingResponse(url, headers, body)
    }
    // Handle non-streaming response
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(errorData)}`
      )
    }

    return (await response.json()) as chatCompletion
  }

  override async delete(opts: deleteOptions): Promise<deleteResult> {
    throw new Error('method not implemented yet')
  }

  override async import(opts: importOptions): Promise<importResult> {
    throw new Error('method not implemented yet')
  }

  override async abortPull(opts: abortPullOptions): Promise<abortPullResult> {
    throw new Error('method not implemented yet')
  }

  // Optional method for direct client access
  override getChatClient(sessionId: string): any {
    throw new Error('method not implemented yet')
  }

  onUnload(): void {
    throw new Error('Method not implemented.')
  }
}

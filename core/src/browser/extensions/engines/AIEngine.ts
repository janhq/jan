import { BaseExtension } from '../../extension'
import { EngineManager } from './EngineManager'

/* AIEngine class types */

export interface chatCompletionRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | Content[] // Content can be a string OR an array of content parts
  reasoning?: string | null // Some models return reasoning in completed responses
  reasoning_content?: string | null // Some models return reasoning in completed responses
  name?: string
  tool_calls?: any[] // Simplified tool_call_id?: string
}

export interface Content {
  type: 'text' | 'image_url' | 'input_audio'
  text?: string
  image_url?: string
  input_audio?: InputAudio
}

export interface InputAudio {
  data: string // Base64 encoded audio data
  format: 'mp3' | 'wav' | 'ogg' | 'flac' // Add more formats as needed/llama-server seems to support mp3
}

export interface ToolFunction {
  name: string // Required: a-z, A-Z, 0-9, _, -, max length 64
  description?: string
  parameters?: Record<string, unknown> // JSON Schema object
  strict?: boolean | null // Defaults to false
}

export interface Tool {
  type: 'function' // Currently, only 'function' is supported
  function: ToolFunction
}

export interface ToolCallOptions {
  tools?: Tool[]
}

// A specific tool choice to force the model to call
export interface ToolCallSpec {
  type: 'function'
  function: {
    name: string
  }
}

// tool_choice may be one of several modes or a specific call
export type ToolChoice = 'none' | 'auto' | 'required' | ToolCallSpec

export interface chatCompletionRequest {
  model: string // Model ID, though for local it might be implicit via sessionInfo
  messages: chatCompletionRequestMessage[]
  thread_id?: string // Thread/conversation ID for context tracking
  return_progress?: boolean
  tools?: Tool[]
  tool_choice?: ToolChoice
  // Core sampling parameters
  temperature?: number | null
  dynatemp_range?: number | null
  dynatemp_exponent?: number | null
  top_k?: number | null
  top_p?: number | null
  min_p?: number | null
  typical_p?: number | null
  repeat_penalty?: number | null
  repeat_last_n?: number | null
  presence_penalty?: number | null
  frequency_penalty?: number | null
  dry_multiplier?: number | null
  dry_base?: number | null
  dry_allowed_length?: number | null
  dry_penalty_last_n?: number | null
  dry_sequence_breakers?: string[] | null
  xtc_probability?: number | null
  xtc_threshold?: number | null
  mirostat?: number | null // 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0
  mirostat_tau?: number | null
  mirostat_eta?: number | null

  n_predict?: number | null
  n_indent?: number | null
  n_keep?: number | null
  stream?: boolean | null
  stop?: string | string[] | null
  seed?: number | null // RNG seed

  // Advanced sampling
  logit_bias?: { [key: string]: number } | null
  n_probs?: number | null
  min_keep?: number | null
  t_max_predict_ms?: number | null
  image_data?: Array<{ data: string; id: number }> | null

  // Internal/optimization parameters
  id_slot?: number | null
  cache_prompt?: boolean | null
  return_tokens?: boolean | null
  samplers?: string[] | null
  timings_per_token?: boolean | null
  post_sampling_probs?: boolean | null
  chat_template_kwargs?: chat_template_kdict | null
}

export interface chat_template_kdict {
  enable_thinking: false
}

export interface chatCompletionChunkChoiceDelta {
  content?: string | null
  role?: 'system' | 'user' | 'assistant' | 'tool'
  tool_calls?: any[] // Simplified
}

export interface chatCompletionChunkChoice {
  index: number
  delta: chatCompletionChunkChoiceDelta
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null
}

export interface chatCompletionPromptProgress {
  cache: number
  processed: number
  time_ms: number
  total: number
}

export interface chatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: chatCompletionChunkChoice[]
  system_fingerprint?: string
  prompt_progress?: chatCompletionPromptProgress
}

export interface chatCompletionChoice {
  index: number
  message: chatCompletionRequestMessage // Response message
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call'
  logprobs?: any // Simplified
}

export interface chatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string // Model ID used
  choices: chatCompletionChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  system_fingerprint?: string
}
// --- End OpenAI types ---

// Shared model metadata
export interface modelInfo {
  id: string // e.g. "qwen3-4B" or "org/model/quant"
  name: string // human‑readable, e.g., "Qwen3 4B Q4_0"
  quant_type?: string // q4_0 (optional as it might be part of ID or name)
  providerId: string // e.g. "llama.cpp"
  port: number
  sizeBytes: number
  tags?: string[]
  path?: string // Absolute path to the model file, if applicable
  // Additional provider-specific metadata can be added here
  embedding?: boolean
  [key: string]: any
}

// 1. /list
export type listResult = modelInfo[]

export interface SessionInfo {
  pid: number // opaque handle for unload/chat
  port: number // llama-server output port (corrected from portid)
  model_id: string //name of the model
  model_path: string // path of the loaded model
  is_embedding: boolean
  api_key: string
  mmproj_path?: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

// 5. /chat
export interface chatOptions {
  providerId: string
  sessionId: string
  /** Full OpenAI ChatCompletionRequest payload */
  payload: chatCompletionRequest
}
// Output for /chat will be Promise<ChatCompletion> for non-streaming
// or Promise<AsyncIterable<ChatCompletionChunk>> for streaming

// 7. /import
export interface ImportOptions {
  modelPath: string
  mmprojPath?: string
  modelSha256?: string
  modelSize?: number
  mmprojSha256?: string
  mmprojSize?: number
  // Additional files to download for MLX models
  files?: Array<{
    url: string
    filename: string
    sha256?: string
    size?: number
  }>
}

export interface importResult {
  success: boolean
  modelInfo?: modelInfo
  error?: string
}

/**
 * Base AIEngine
 * Applicable to all AI Engines
 */

export abstract class AIEngine extends BaseExtension {
  // The inference engine ID, implementing the readonly providerId from interface
  abstract readonly provider: string

  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    this.registerEngine()
  }

  /**
   * Registers AI Engines
   */
  registerEngine() {
    EngineManager.instance().register(this)
  }

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
   * @param modelId - The model identifier
   * @param settings - Optional settings for loading
   * @param isEmbedding - Whether this is an embedding model (skips auto-unload)
   * @param bypassAutoUnload - When true, prevents unloading other models (useful for API server)
   */
  abstract load(modelId: string, settings?: any, isEmbedding?: boolean, bypassAutoUnload?: boolean): Promise<SessionInfo>

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

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
  // True if the model was imported from a user-supplied local file
  // (path lives outside the provider's managed models directory).
  imported?: boolean
  // Chat-template kwargs the model's embedded jinja template accepts
  // (e.g. `preserve_thinking`), detected from the GGUF at import/list time.
  template_kwargs?: TemplateKwarg[]
  [key: string]: any
}

export type TemplateKwargType = 'boolean' | 'number' | 'string'

export interface TemplateKwarg {
  name: string
  type: TemplateKwargType
  default: boolean | number | string
}

// 1. /list
export type listResult = modelInfo[]

export interface SessionInfo {
  pid: number // opaque handle for unload/chat
  port: number // llama-server output port (corrected from portid)
  model_id: string //name of the model
  is_embedding: boolean
  api_key: string
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

/**
 * A speculative-decoding draft flavour, matching llama.cpp's `--spec-type`
 * values minus their `draft-` prefix (common/speculative.cpp). `dspark` is
 * `dflash` plus a Markov head.
 */
export type SpecDraftKind = 'mtp' | 'eagle3' | 'dflash' | 'dspark'

// 7. /import
export interface ImportOptions {
  modelPath: string
  mmprojPath?: string
  modelSha256?: string
  modelSize?: number
  mmprojSha256?: string
  mmprojSize?: number
  // Optional speculative-decoding draft gguf downloaded alongside the model,
  // plus which flavour the catalog named it as. The kind is a hint only: the
  // draft's own `general.architecture` decides, since it is authoritative.
  specDraftPath?: string
  specDraftKind?: SpecDraftKind
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

export interface EmbeddingData {
  embedding: number[]
  index: number
  object?: string
}

export interface EmbeddingResponse {
  data: EmbeddingData[]
  model?: string
  object?: string
  usage?: {
    prompt_tokens: number
    total_tokens: number
  }
}

/**
 * Embedding support an engine may add on top of `AIEngine`.
 *
 * Kept off `AIEngine` because most engines cannot embed. It is an interface
 * rather than optional members so the RAG and vector-db extensions -- which
 * reach the embedding engine by name across the extension boundary -- narrow
 * with `isEmbeddingEngine` instead of casting to a structural type each
 * declares for itself. Three copies of that cast had already drifted apart.
 */
export interface EmbeddingEngine {
  /** Embeds each text, in input order. */
  embed(texts: string[]): Promise<EmbeddingResponse>

  /**
   * The embedding model's context window in tokens, or undefined when no
   * embedding model is available to ask.
   */
  getEmbeddingContextSize(): Promise<number | undefined>

  /** Token counts from the embedding model's own tokenizer, in input order. */
  countEmbeddingTokens(texts: string[]): Promise<number[]>
}

function hasMethod(engine: unknown, name: keyof EmbeddingEngine): boolean {
  return (
    !!engine &&
    typeof engine === 'object' &&
    typeof (engine as Record<string, unknown>)[name] === 'function'
  )
}

/**
 * Narrows to an engine that can produce embeddings.
 *
 * Deliberately weaker than `isEmbeddingEngine`: producing a vector needs no
 * tokenizer, so an engine that can embed but cannot count tokens is usable
 * here and must not be turned away.
 */
export function canEmbed(engine: unknown): engine is AIEngine & Pick<EmbeddingEngine, 'embed'> {
  return hasMethod(engine, 'embed')
}

/**
 * Narrows to an engine implementing the whole embedding contract, including the
 * tokenizer queries that context-aware chunking needs.
 *
 * Checks each method rather than the object as a whole so a partially
 * implemented engine is rejected here instead of throwing on first use.
 */
export function isEmbeddingEngine(engine: unknown): engine is AIEngine & EmbeddingEngine {
  return (
    canEmbed(engine) &&
    hasMethod(engine, 'getEmbeddingContextSize') &&
    hasMethod(engine, 'countEmbeddingTokens')
  )
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

  // Stops an import but keeps the partial download so it can be resumed.
  // Default no-op for engines without resumable downloads.
  async pauseImport(_modelId: string): Promise<void> {}

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

import { BaseExtension } from '../../extension'
import { EngineManager } from './EngineManager'

/* AIEngine class types */

export interface chatCompletionRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | Content[]; // Content can be a string OR an array of content parts
  name?: string;
  tool_calls?: any[]; // Simplified tool_call_id?: string
}

export interface Content {
  type: 'text' | 'input_image' | 'input_audio';
  text?: string;
  image_url?: string;
  input_audio?: InputAudio;
}

export interface InputAudio {
  data: string; // Base64 encoded audio data
  format: 'mp3' | 'wav' | 'ogg' | 'flac'; // Add more formats as needed/llama-server seems to support mp3
}

export interface chatCompletionRequest {
  provider: string,
  model: string // Model ID, though for local it might be implicit via sessionId
  messages: chatCompletionRequestMessage[]
  temperature?: number | null
  top_p?: number | null
  n?: number | null
  stream?: boolean | null
  stop?: string | string[] | null
  max_tokens?: number
  presence_penalty?: number | null
  frequency_penalty?: number | null
  logit_bias?: { [key: string]: number } | null
  user?: string
  // ... TODO: other OpenAI params
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

export interface chatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: chatCompletionChunkChoice[]
  system_fingerprint?: string
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
  [key: string]: any
}

// 1. /list
export type listResult = modelInfo[]

// 3. /load
export interface loadOptions {
  modelPath: string
  port?: number
}

export interface sessionInfo {
  sessionId: string // opaque handle for unload/chat
  port: number // llama-server output port (corrected from portid)
  modelName: string, //name of the model
  modelPath: string // path of the loaded model
}

// 4. /unload
export interface unloadOptions {
  providerId: string
  sessionId: string
}
export interface unloadResult {
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
  [key: string]: any
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
   * Lists available models
   */
  abstract list(): Promise<listResult>

  /**
   * Loads a model into memory
   */
  abstract load(opts: loadOptions): Promise<sessionInfo>

  /**
   * Unloads a model from memory
   */
  abstract unload(opts: unloadOptions): Promise<unloadResult>

  /**
   * Sends a chat request to the model
   */
  abstract chat(opts: chatCompletionRequest): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>>

  /**
   * Deletes a model
   */
  abstract delete(modelId: string): Promise<void>

  /**
   * Imports a model
   */
  abstract import(modelId: string, opts: ImportOptions): Promise<void>

  /**
   * Aborts an ongoing model import
   */
  abstract abortImport(modelId: string): Promise<void>

  /**
   * Optional method to get the underlying chat client
   */
  getChatClient?(sessionId: string): any
}

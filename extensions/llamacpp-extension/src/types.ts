// src/providers/local/types.ts

// --- Re-using OpenAI types (minimal definitions for this example) ---
// In a real project, you'd import these from 'openai' or a shared types package.
export interface chatCompletionRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: any[]; // Simplified
  tool_call_id?: string;
}

export interface chatCompletionRequest {
  model: string; // Model ID, though for local it might be implicit via sessionId
  messages: chatCompletionRequestMessage[];
  temperature?: number | null;
  top_p?: number | null;
  n?: number | null;
  stream?: boolean | null;
  stop?: string | string[] | null;
  max_tokens?: number;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  logit_bias?: Record<string, number> | null;
  user?: string;
  // ... TODO: other OpenAI params
}

export interface chatCompletionChunkChoiceDelta {
  content?: string | null;
  role?: 'system' | 'user' | 'assistant' | 'tool';
  tool_calls?: any[]; // Simplified
}

export interface chatCompletionChunkChoice {
  index: number;
  delta: chatCompletionChunkChoiceDelta;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface chatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: chatCompletionChunkChoice[];
  system_fingerprint?: string;
}


export interface chatCompletionChoice {
  index: number;
  message: chatCompletionRequestMessage; // Response message
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';
  logprobs?: any; // Simplified
}

export interface chatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string; // Model ID used
  choices: chatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}
// --- End OpenAI types ---


// Shared model metadata
export interface modelInfo {
  id: string;            // e.g. "qwen3-4B" or "org/model/quant"
  name: string;          // human‑readable, e.g., "Qwen3 4B Q4_0"
  quant_type?: string;    // q4_0 (optional as it might be part of ID or name)
  providerId: string;    // e.g. "llama.cpp"
  port: number;
  sizeBytes: number;
  tags?: string[];
  path?: string;          // Absolute path to the model file, if applicable
  // Additional provider-specific metadata can be added here
  [key: string]: any;
}

// 1. /list
export interface listOptions {
  providerId: string; // To specify which provider if a central manager calls this
}
export type listResult = ModelInfo[];

// 2. /pull
export interface pullOptions {
  providerId: string;
  modelId: string;         // Identifier for the model to pull (e.g., from a known registry)
  downloadUrl: string;     // URL to download the model from
  /** optional callback to receive download progress */
  onProgress?: (progress: { percent: number; downloadedBytes: number; totalBytes?: number; }) => void;
}
export interface pullResult {
  success: boolean;
  path?: string;         // local file path to the pulled model
  error?: string;
  modelInfo?: modelInfo; // Info of the pulled model
}

// 3. /load
export interface loadOptions {
  modelPath: string
  port?: number
  n_gpu_layers?: number
  n_ctx?: number
  threads?: number
  threads_batch?: number
  ctx_size?: number
  n_predict?: number
  batch_size?: number
  ubatch_size?: number
  device?: string
  split_mode?: string
  main_gpu?: number
  flash_attn?: boolean
  cont_batching?: boolean
  no_mmap?: boolean
  mlock?: boolean
  no_kv_offload?: boolean
  cache_type_k?: string
  cache_type_v?: string
  defrag_thold?: number
  rope_scaling?: string
  rope_scale?: number
  rope_freq_base?: number
  rope_freq_scale?: number
}

export interface sessionInfo {
  sessionId: string;    // opaque handle for unload/chat
  port: number;       // llama-server output port (corrected from portid)
  modelPath: string;    // path of the loaded model
  settings: Record<string, unknown>; // The actual settings used to load
}

// 4. /unload
export interface unloadOptions {
  providerId: string;
  sessionId: string;
}
export interface unloadResult {
  success: boolean;
  error?: string;
}

// 5. /chat
export interface chatOptions {
  providerId: string;
  sessionId: string;
  /** Full OpenAI ChatCompletionRequest payload */
  payload: chatCompletionRequest;
}
// Output for /chat will be Promise<ChatCompletion> for non-streaming
// or Promise<AsyncIterable<ChatCompletionChunk>> for streaming

// 6. /delete
export interface deleteOptions {
  providerId: string;
  modelId: string; // The ID of the model to delete (implies finding its path)
  modelPath?: string; // Optionally, direct path can be provided
}
export interface deleteResult {
  success: boolean;
  error?: string;
}

// 7. /import
export interface importOptions {
  providerId: string;
  sourcePath: string; // Path to the local model file to import
  desiredModelId?: string; // Optional: if user wants to name it specifically
}
export interface importResult {
  success: boolean;
  modelInfo?: modelInfo;
  error?: string;
}

// 8. /abortPull
export interface abortPullOptions {
  providerId: string;
  modelId: string; // The modelId whose download is to be aborted
}
export interface abortPullResult {
  success: boolean;
  error?: string;
}


// The interface for any local provider
export interface localProvider {
  readonly providerId: string;

  list(opts: listOptions): Promise<listResult>;
  pull(opts: pullOptions): Promise<pullResult>;
  load(opts: loadOptions): Promise<sessionInfo>;
  unload(opts: unloadOptions): Promise<unloadResult>;
  chat(opts: chatOptions): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>>;
  delete(opts: deleteOptions): Promise<deleteResult>;
  import(opts: importOptions): Promise<importResult>;
  abortPull(opts: abortPullOptions): Promise<abortPullResult>;

  // Optional: for direct access to underlying client if needed for specific streaming cases
  getChatClient?(sessionId: string): any; // e.g., an OpenAI client instance configured for the session
}

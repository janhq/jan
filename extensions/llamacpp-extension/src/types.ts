// src/providers/local/types.ts

// --- Re-using OpenAI types (minimal definitions for this example) ---
// In a real project, you'd import these from 'openai' or a shared types package.
export interface ChatCompletionRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: any[]; // Simplified
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string; // Model ID, though for local it might be implicit via sessionId
  messages: ChatCompletionRequestMessage[];
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

export interface ChatCompletionChunkChoiceDelta {
  content?: string | null;
  role?: 'system' | 'user' | 'assistant' | 'tool';
  tool_calls?: any[]; // Simplified
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkChoiceDelta;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  system_fingerprint?: string;
}


export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionRequestMessage; // Response message
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';
  logprobs?: any; // Simplified
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string; // Model ID used
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}
// --- End OpenAI types ---


// Shared model metadata
export interface ModelInfo {
  id: string;            // e.g. "qwen3-4B" or "org/model/quant"
  name: string;          // human‑readable, e.g., "Qwen3 4B Q4_0"
  quant_type?: string;    // q4_0 (optional as it might be part of ID or name)
  providerId: string;    // e.g. "llama.cpp"
  sizeBytes: number;
  tags?: string[];
  path?: string;          // Absolute path to the model file, if applicable
  // Additional provider-specific metadata can be added here
  [key: string]: any;
}

// 1. /list
export interface ListOptions {
  providerId: string; // To specify which provider if a central manager calls this
}
export type ListResult = ModelInfo[];

// 2. /pull
export interface PullOptions {
  providerId: string;
  modelId: string;         // Identifier for the model to pull (e.g., from a known registry)
  downloadUrl: string;     // URL to download the model from
  /** optional callback to receive download progress */
  onProgress?: (progress: { percent: number; downloadedBytes: number; totalBytes?: number; }) => void;
}
export interface PullResult {
  success: boolean;
  path?: string;         // local file path to the pulled model
  error?: string;
  modelInfo?: ModelInfo; // Info of the pulled model
}

// 3. /load
export interface LoadOptions {
  providerId: string;
  modelPath: string;
  /** any provider‑specific tuning options for llama.cpp server */
  options?: {
    port?: number; // 0 means dynamic port
    n_gpu_layers?: number;
    n_ctx?: number; // context size
    // ... other llama-cpp-python or llama.cpp server flags
    [key: string]: any;
  };
}

export interface SessionInfo {
  sessionId: string;    // opaque handle for unload/chat
  port: number;       // llama-server output port (corrected from portid)
  modelPath: string;    // path of the loaded model
  providerId: string;
  settings: Record<string, unknown>; // The actual settings used to load
}

// 4. /unload
export interface UnloadOptions {
  providerId: string;
  sessionId: string;
}
export interface UnloadResult {
  success: boolean;
  error?: string;
}

// 5. /chat
export interface ChatOptions {
  providerId: string;
  sessionId: string;
  /** Full OpenAI ChatCompletionRequest payload */
  payload: ChatCompletionRequest;
}
// Output for /chat will be Promise<ChatCompletion> for non-streaming
// or Promise<AsyncIterable<ChatCompletionChunk>> for streaming

// 6. /delete
export interface DeleteOptions {
  providerId: string;
  modelId: string; // The ID of the model to delete (implies finding its path)
  modelPath?: string; // Optionally, direct path can be provided
}
export interface DeleteResult {
  success: boolean;
  error?: string;
}

// 7. /import
export interface ImportOptions {
  providerId: string;
  sourcePath: string; // Path to the local model file to import
  desiredModelId?: string; // Optional: if user wants to name it specifically
}
export interface ImportResult {
  success: boolean;
  modelInfo?: ModelInfo;
  error?: string;
}

// 8. /abortPull
export interface AbortPullOptions {
  providerId: string;
  modelId: string; // The modelId whose download is to be aborted
}
export interface AbortPullResult {
  success: boolean;
  error?: string;
}


// The interface for any local provider
export interface LocalProvider {
  readonly providerId: string;

  listModels(opts: ListOptions): Promise<ListResult>;
  pullModel(opts: PullOptions): Promise<PullResult>;
  loadModel(opts: LoadOptions): Promise<SessionInfo>;
  unloadModel(opts: UnloadOptions): Promise<UnloadResult>;
  chat(opts: ChatOptions): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
  deleteModel(opts: DeleteOptions): Promise<DeleteResult>;
  importModel(opts: ImportOptions): Promise<ImportResult>;
  abortPull(opts: AbortPullOptions): Promise<AbortPullResult>;

  // Optional: for direct access to underlying client if needed for specific streaming cases
  getChatClient?(sessionId: string): any; // e.g., an OpenAI client instance configured for the session
}

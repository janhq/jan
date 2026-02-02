export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  model_path: string
  is_embedding: boolean
  api_key: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

export type MlxConfig = {
  ctx_size: number
  n_predict: number
  threads: number
  chat_template: string
  batch_size: number
  batch_timeout_ms: number
  enable_continuous_batching: boolean
  kv_block_size: number
  enable_prefix_caching: boolean
}

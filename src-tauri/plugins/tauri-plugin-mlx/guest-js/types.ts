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
  draft_model_path: string
  block_size: number
  /// Drafter family — "dflash" (default) or "mtp" (Gemma 4 assistant).
  /// Empty string is treated by the Rust shim as "dflash".
  draft_kind: string
}

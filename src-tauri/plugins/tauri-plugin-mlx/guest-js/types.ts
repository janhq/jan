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
  /// KV-cache quantization bit-width (e.g. 3.5 for TurboQuant). 0 disables
  /// quantization; the Rust shim only emits `--kv-bits` when this is > 0 and
  /// a real `kv_quant_scheme` is set.
  kv_bits: number
  /// KV-cache quantization scheme — "" / "off" (no quantization, default),
  /// "uniform" or "turboquant". Passed verbatim to `--kv-quant-scheme`.
  kv_quant_scheme: string
}

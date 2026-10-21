export interface SessionInfo {
  /** The provider id of the engine that owns the session. */
  engine: string
  /** The model id the session was started for. */
  model_id: string
  /** Filesystem path of the loaded model. */
  model_path: string
  /** Port the engine sidecar listens on. */
  port: number
  /** Bearer token the sidecar requires. */
  api_key: string
  /** Process id of the sidecar. */
  pid: number
}

export interface LocalEngineConfig {
  /** Context window the engine should run with. */
  ctx_size: number
  /** Threads the engine may use; 0 lets the runtime decide. */
  threads: number
  /** Bearer token to require; the plugin generates one when omitted. */
  api_key?: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

export interface EngineAvailability {
  engine: string
  available: boolean
  python?: string
  package?: string
  error?: string
}

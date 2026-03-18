export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  api_key: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

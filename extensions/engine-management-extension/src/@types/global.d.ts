declare const API_URL: string
declare const CORTEX_ENGINE_VERSION: string
declare const SOCKET_URL: string
declare const NODE: string

declare const DEFAULT_REMOTE_ENGINES: ({
  id: string
  engine: string
} & EngineConfig)[]
declare const DEFAULT_REMOTE_MODELS: Model[]

interface Core {
  api: APIFunctions
  events: EventEmitter
}
interface Window {
  core?: Core | undefined
  electronAPI?: any | undefined
}

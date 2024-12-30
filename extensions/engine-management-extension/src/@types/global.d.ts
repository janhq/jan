export {}
declare global {
  declare const API_URL: string
  declare const CORTEX_ENGINE_VERSION: string
  declare const SOCKET_URL: string
  declare const NODE: string

  interface Core {
    api: APIFunctions
    events: EventEmitter
  }
  interface Window {
    core?: Core | undefined
    electronAPI?: any | undefined
  }
}

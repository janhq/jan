export {}
declare global {
  declare const EXTENSION_NAME: string
  declare const MODULE_PATH: string
  declare const VERSION: string

  interface Core {
    api: APIFunctions
    events: EventEmitter
  }
  interface Window {
    core?: Core | undefined
    electronAPI?: any | undefined
  }
}

export {}
declare global {
  declare const DEFAULT_MODEL: object
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

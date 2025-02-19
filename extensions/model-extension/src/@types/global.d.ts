declare const NODE: string
declare const API_URL: string
declare const SETTINGS: SettingComponentProps[]
declare const DEFAULT_MODEL_SOURCES: any

interface Core {
  api: APIFunctions
  events: EventEmitter
}
interface Window {
  core?: Core | undefined
  electronAPI?: any | undefined
}

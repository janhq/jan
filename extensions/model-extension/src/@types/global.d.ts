declare const NODE: string
declare const API_URL: string
declare const SOCKET_URL: string
declare const SETTINGS: SettingComponentProps[]

interface Core {
  api: APIFunctions
  events: EventEmitter
}
interface Window {
  core?: Core | undefined
  electronAPI?: any | undefined
}

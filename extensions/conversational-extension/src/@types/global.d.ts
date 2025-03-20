declare const API_URL: string

interface Core {
  api: APIFunctions
  events: EventEmitter
}
interface Window {
  core?: Core | undefined
  electronAPI?: any | undefined
}

interface Core {
  api: APIFunctions
  events: EventEmitter
}
interface Window {
  core?: Core | undefined
}

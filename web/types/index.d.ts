import { APIRoutes } from '@janhq/core'

/* eslint-disable @typescript-eslint/no-explicit-any */
export {}

declare global {
  declare const PLUGIN_CATALOG: string
  declare const VERSION: string
  interface Core {
    api: APIRoutes
    events: EventEmitter
  }
  interface Window {
    core?: Core | undefined
    electronAPI?: any | undefined
  }
}

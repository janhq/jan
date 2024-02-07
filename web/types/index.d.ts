import { APIFunctions } from '@janhq/core'

/* eslint-disable @typescript-eslint/no-explicit-any */
export {}

declare global {
  declare const VERSION: string
  declare const ANALYTICS_ID: string
  declare const ANALYTICS_HOST: string
  declare const API_BASE_URL: string
  declare const isMac: boolean
  declare const isWindows: boolean
  declare const isLinux: boolean
  interface Core {
    api: APIFunctions
    events: EventEmitter
  }
  interface Window {
    core?: Core | undefined
    electronAPI?: any | undefined
  }
}

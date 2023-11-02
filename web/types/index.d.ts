/* eslint-disable @typescript-eslint/no-explicit-any */
export {}

declare global {
  declare const PLUGIN_CATALOG: string
  declare const VERSION: string
  interface Window {
    electronAPI?: any | undefined
    corePlugin?: any | undefined
    coreAPI?: any | undefined
    pluggableElectronIpc?: any | undefined
  }
}

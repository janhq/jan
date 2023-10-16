export {}

declare global {
  declare const PLUGIN_CATALOG: string
  declare const VERSION: string
  interface Window {
    electronAPI?: any | undefined;
    corePlugin?: any | undefined;
    coreAPI?: any | undefined;
  }
}

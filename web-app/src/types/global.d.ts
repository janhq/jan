export {}

declare module 'react-syntax-highlighter-virtualized-renderer'

type AppCore = {
  api: APIs
  extensionManager: ExtensionManager | undefined
}

declare global {
  declare const IS_TAURI: boolean
  declare const IS_WEB_APP: boolean
  declare const IS_MACOS: boolean
  declare const IS_WINDOWS: boolean
  declare const IS_LINUX: boolean
  declare const IS_IOS: boolean
  declare const IS_ANDROID: boolean
  declare const PLATFORM: string
  declare const VERSION: string
  declare const POSTHOG_KEY: string
  declare const POSTHOG_HOST: string
  declare const MODEL_CATALOG_URL: string
  declare const AUTO_UPDATER_DISABLED: boolean
  declare const GA_MEASUREMENT_ID: string
  declare const IS_DEV: boolean
  interface Window {
    core: AppCore | undefined
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

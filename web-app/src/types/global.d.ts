import { ExtensionManager } from '@/lib/extension'

type Language = 'en' | 'id' | 'vn'
declare module 'react-syntax-highlighter-virtualized-renderer'

type AppCore = {
  api: APIs
  extensionManager: ExtensionManager | undefined
}
declare global {
  interface Window {
    core: AppCore | undefined
  }

  let IS_TAURI: boolean
  let IS_MACOS: boolean
  let IS_WINDOWS: boolean
  let IS_LINUX: boolean
  let IS_IOS: boolean
  let IS_ANDROID: boolean
  let PLATFORM: string
}
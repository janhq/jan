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
}
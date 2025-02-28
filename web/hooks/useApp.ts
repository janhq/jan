import { extensionManager } from '@/extension'

export function useApp() {
  async function relaunch() {
    const extensions = extensionManager.getAll()
    await Promise.all(extensions.map((e) => e.onUnload()))
    window.core?.api?.relaunch()
  }
  return { relaunch }
}

import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { PropsWithChildren, useCallback, useEffect } from 'react'

export function ExtensionProvider({ children }: PropsWithChildren) {
  const setupExtensions = useCallback(async () => {
    window.core = { api: APIs }

    // Register all active extensions
    await ExtensionManager.getInstance()
      .registerActive()
      .then(() => ExtensionManager.getInstance().load())
  }, [])

  useEffect(() => {
    setupExtensions()

    return () => {
      ExtensionManager.getInstance().unload()
    }
  }, [setupExtensions])

  return <>{children}</>
}

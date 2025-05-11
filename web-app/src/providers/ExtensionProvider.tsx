import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EngineManager } from '@janhq/core'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [finishedSetup, setFinishedSetup] = useState(false)
  const setupExtensions = useCallback(async () => {
    window.core = { api: APIs, engineManager: new EngineManager() }

    // Register all active extensions
    await ExtensionManager.getInstance()
      .registerActive()
      .then(() => ExtensionManager.getInstance().load())
      .then(() => setFinishedSetup(true))
  }, [])

  useEffect(() => {
    setupExtensions()

    return () => {
      ExtensionManager.getInstance().unload()
    }
  }, [setupExtensions])

  return <>{finishedSetup && children}</>
}

import { PlatformExtensionManager, WebAPIAdapter, isPlatformTauri } from '@/lib/platform'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events'
import { EngineManager, ModelManager } from '@janhq/core'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [finishedSetup, setFinishedSetup] = useState(false)
  const setupExtensions = useCallback(async () => {
    // Choose API adapter based on platform
    const apiAdapter = isPlatformTauri() ? APIs : new WebAPIAdapter()
    
    window.core = {
      api: apiAdapter,
    }

    window.core.events = new EventEmitter()
    window.core.extensionManager = new PlatformExtensionManager()
    window.core.engineManager = new EngineManager()
    window.core.modelManager = new ModelManager()

    // Register all active extensions (platform-aware)
    await window.core.extensionManager
      .registerActive()
      .then(() => window.core.extensionManager.load())
      .then(() => setFinishedSetup(true))
  }, [])

  useEffect(() => {
    setupExtensions()

    return () => {
      window.core.extensionManager?.unload()
    }
  }, [setupExtensions])

  return <>{finishedSetup && children}</>
}

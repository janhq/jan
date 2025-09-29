import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager } from '@janhq/core'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [finishedSetup, setFinishedSetup] = useState(false)
  const setupExtensions = useCallback(async () => {
    // Setup core window object for both platforms
    window.core = {
      api: APIs,
    }

    window.core.events = new EventEmitter()
    window.core.extensionManager = new ExtensionManager()
    window.core.engineManager = new EngineManager()
    window.core.modelManager = new ModelManager()

    // Register extensions - same pattern for both platforms
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

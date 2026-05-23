import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager } from '@janhq/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

// Secondary windows (logs, system monitor) reuse the same React bundle but
// their Tauri capabilities do not grant hardware:*/llamacpp:*/etc. Loading
// extensions there triggers ACL-denied invokes and would double-spawn the
// llama-server router. Gate the whole pipeline on the main window.
function isMainWindow(): boolean {
  try {
    return getCurrentWebviewWindow().label === 'main'
  } catch {
    return true
  }
}

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

    if (!isMainWindow()) {
      setFinishedSetup(true)
      return
    }

    // Register extensions - same pattern for both platforms.
    // Always finish setup even if registration/load throws so a single
    // faulty extension can't gate the entire UI.
    try {
      await ExtensionManager.getInstance().registerActive()
      await ExtensionManager.getInstance().load()
    } catch (e) {
      console.error('Extension setup failed:', e)
    } finally {
      setFinishedSetup(true)
    }
  }, [])

  useEffect(() => {
    setupExtensions()

    return () => {
      if (isMainWindow()) {
        ExtensionManager.getInstance().unload()
      }
    }
  }, [setupExtensions])

  return <>{finishedSetup && children}</>
}

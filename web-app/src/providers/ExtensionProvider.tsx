import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager } from '@janhq/core'
import { isPlatformTauri } from '@/lib/platform'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

// Web extension loader
async function loadWebExtensions() {
  try {
    // Dynamic import to avoid bundling in Tauri builds
    const { WEB_EXTENSIONS } = await import('@jan/extensions-web')

    const extensionManager = ExtensionManager.getInstance()
    
    // Load all web extensions from the registry
    const extensionPromises = Object.entries(WEB_EXTENSIONS).map(async ([name, loader]) => {
      try {
        const extensionModule = await loader()
        const ExtensionClass = extensionModule.default
        extensionManager.register(name, new ExtensionClass())
        console.log(`Web extension '${name}' loaded successfully`)
      } catch (error) {
        console.error(`Failed to load web extension '${name}':`, error)
        throw error
      }
    })
    
    await Promise.all(extensionPromises)
    console.log('All web extensions loaded successfully')
  } catch (error) {
    console.error('Failed to load web extensions:', error)
    throw error
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

    // Register platform-specific extensions
    if (isPlatformTauri()) {
      // Tauri platform - register all active extensions from filesystem
      await ExtensionManager.getInstance()
        .registerActive()
        .then(() => ExtensionManager.getInstance().load())
        .then(() => setFinishedSetup(true))
    } else {
      // Web platform - load web-specific extensions
      console.log('Web platform detected - loading web extensions')
      await loadWebExtensions()
        .then(() => ExtensionManager.getInstance().load())
        .then(() => setFinishedSetup(true))
    }
  }, [])

  useEffect(() => {
    setupExtensions()

    return () => {
      ExtensionManager.getInstance().unload()
    }
  }, [setupExtensions])

  return <>{finishedSetup && children}</>
}

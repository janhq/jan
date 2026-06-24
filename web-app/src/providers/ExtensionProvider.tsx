import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager } from '@janhq/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit } from '@tauri-apps/api/event'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'

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

type SetupStatus = { key: string; vars?: Record<string, unknown> } | null

export function ExtensionProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const [finishedSetup, setFinishedSetup] = useState(false)
  const [status, setStatus] = useState<SetupStatus>(null)
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
      setStatus({ key: 'registeringExtensions' })
      await ExtensionManager.getInstance().registerActive()
      await ExtensionManager.getInstance().load((done, total) =>
        setStatus({ key: 'loadingExtensions', vars: { done, total } })
      )
    } catch (e) {
      console.error('Extension setup failed:', e)
    } finally {
      setFinishedSetup(true)
    }
  }, [])

  useEffect(() => {
    // Watchdog: a hung extension (stuck migration, blocked invoke) must never
    // leave the app on a blank window. Setup still completes in the background.
    const watchdog = setTimeout(() => {
      console.warn('Extension setup exceeded timeout; rendering UI anyway.')
      setFinishedSetup(true)
    }, 20000)

    setupExtensions().finally(() => clearTimeout(watchdog))

    return () => {
      clearTimeout(watchdog)
      if (isMainWindow()) {
        ExtensionManager.getInstance().unload()
      }
    }
  }, [setupExtensions])

  useEffect(() => {
    const caption = document.getElementById('initial-loader-caption')
    if (caption) {
      caption.textContent = status ? t(status.key, status.vars) : t('settingUpJan')
    }
  }, [status, t])

  // Emit app-ready immediately after first paint so backend can start MCP servers.
  // Extensions continue loading in the background without blocking the backend.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (isMainWindow()) emit('app-ready').catch(() => {})
      document.body.classList.add('loaded')
    })
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  // Dismiss the loader once extensions have finished loading.
  useEffect(() => {
    if (!finishedSetup) return
    const removeTimer = setTimeout(() => {
      document.getElementById('initial-loader')?.remove()
    }, 300)
    return () => {
      clearTimeout(removeTimer)
    }
  }, [finishedSetup])

  return <>{finishedSetup && children}</>
}

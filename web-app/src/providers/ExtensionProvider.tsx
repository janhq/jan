import { getHostBuiltins } from '@/lib/extensions/builtins'
import { getExtensionHost } from '@/lib/extensions/host'
import { loadWithCrashLoopGuard } from '@/lib/extensions/watchdog'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformAndroid, isPlatformIOS } from '@/lib/platform'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager, appSettings } from '@janhq/core'
import { toast } from 'sonner'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit } from '@tauri-apps/api/event'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'
import { i18n, useTranslation } from '@/i18n/react-i18next-compat'

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
    window.core.engineManager = new EngineManager()
    window.core.modelManager = new ModelManager()

    if (!isMainWindow()) {
      setFinishedSetup(true)
      return
    }

    // Register extensions - same pattern for both platforms.
    // Always finish setup even if registration/load throws so a single
    // faulty extension can't gate the entire UI.
    setStatus({ key: 'registeringExtensions' })
    // Built-ins first, then the installed extensions.
    try {
      await getExtensionHost().activateBuiltins(
        getHostBuiltins({ mobile: isPlatformIOS() || isPlatformAndroid() })
      )
    } catch (e) {
      console.error('Extension host setup failed:', e)
    }
    // Installed extensions run in workers after the built-ins, where there
    // is an install pipeline (the desktop app). Not awaited: each may take
    // up to its activation timeout, and llamacpp/mlx must not wait on that.
    // The guard turns safe mode on when earlier starts never got them
    // loaded, so one that takes the window down cannot do it every start.
    const installedFailed = (e: unknown) =>
      console.error('Loading installed extensions failed:', e)
    try {
      const service = getServiceHub().extensions()
      if (service.isSupported())
        void loadWithCrashLoopGuard({
          settings: appSettings,
          setSafeMode: (on) => service.setSafeMode(on),
          onSafeMode: () => toast.warning(i18n.t('extensions:crashed.safeMode')),
          load: () => getExtensionHost().loadInstalled(),
        }).catch(installedFailed)
    } catch (e) {
      installedFailed(e)
    }
    setFinishedSetup(true)
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
        getExtensionHost().deactivateAll()
      }
    }
  }, [setupExtensions])

  useEffect(() => {
    const caption = document.getElementById('initial-loader-caption')
    if (caption) {
      caption.textContent = status ? t(status.key, status.vars) : t('settingUpJan')
    }
  }, [status, t])

  // Dismiss the loader only once the gated UI is ready, not on a fixed timer.
  useEffect(() => {
    if (!finishedSetup) return
    if (isMainWindow()) emit('app-ready').catch(() => {})
    let removeTimer: ReturnType<typeof setTimeout>
    const raf = requestAnimationFrame(() => {
      document.body.classList.add('loaded')
      removeTimer = setTimeout(() => {
        document.getElementById('initial-loader')?.remove()
      }, 300)
    })
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(removeTimer)
    }
  }, [finishedSetup])

  return <>{finishedSetup && children}</>
}

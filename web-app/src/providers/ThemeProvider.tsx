import { useEffect } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { isPlatformTauri } from '@/lib/platform/utils'

export function ThemeProvider() {
  const { isDark, setIsDark, activeTheme } = useTheme()

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    if (IS_LINUX && isPlatformTauri()) {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_gtk_prefer_dark', { dark: isDark }))
        .catch((err) => console.error('set_gtk_prefer_dark failed:', err))
    }
  }, [isDark])

  useEffect(() => {
    let cancelled = false
    let unlistenTauri: (() => void) | undefined

    // Always check the latest activeTheme at event time — calling
    // window.setTheme() from the switcher fires portal/WindowEvent events that
    // would otherwise race the zustand commit and pin isDark to the system
    // value even when the user picked an explicit light/dark override.
    const applyIfAuto = (next: boolean) => {
      if (useTheme.getState().activeTheme === 'auto') setIsDark(next)
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = (e: MediaQueryListEvent) => applyIfAuto(e.matches)
    mediaQuery.addEventListener('change', handleMediaChange)

    if (isPlatformTauri()) {
      // On Linux, WebKitGTK's prefers-color-scheme does not reliably track the
      // XDG Desktop Portal. Source-of-truth is the Rust-side portal read +
      // SettingChanged signal, re-emitted as the `theme-changed` event.
      Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ])
        .then(async ([{ listen }, { invoke }]) => {
          const unlisten = await listen<string>('theme-changed', (event) => {
            applyIfAuto(event.payload === 'dark')
          })
          if (cancelled) {
            unlisten()
            return
          }
          unlistenTauri = unlisten

          try {
            const initial = await invoke<string>('get_system_theme')
            if (!cancelled) applyIfAuto(initial === 'dark')
          } catch (err) {
            console.error('get_system_theme failed:', err)
          }
        })
        .catch((err) => {
          console.error('Failed to setup Tauri theme listener:', err)
        })
    } else {
      applyIfAuto(mediaQuery.matches)
    }

    return () => {
      cancelled = true
      mediaQuery.removeEventListener('change', handleMediaChange)
      unlistenTauri?.()
    }
    // Re-query the portal on activeTheme change: matchMedia stays pinned to the
    // prior explicit theme after window.setTheme(), so 'auto' needs a fresh read.
  }, [setIsDark, activeTheme])

  return null
}

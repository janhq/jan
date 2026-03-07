import { useEffect } from 'react'
import { useTheme, checkOSDarkMode } from '@/hooks/useTheme'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * ThemeProvider ensures theme settings are applied on every page load
 * This component should be mounted at the root level of the application
 * It first detects the OS theme preference and applies it accordingly
 */
export function ThemeProvider() {
  const { activeTheme, isDark, setIsDark, setTheme } = useTheme()

  // Apply dark class to root element
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  // Detect OS theme on mount and apply it
  useEffect(() => {
    // Force refresh theme on mount to handle Linux startup timing issues
    const refreshTheme = () => {
      if (activeTheme === 'auto') {
        const isDarkMode = checkOSDarkMode()
        setIsDark(isDarkMode)
        setTheme('auto')
      }
    }

    // Initial refresh
    refreshTheme()

    // On Linux, desktop environment may not be ready immediately
    // Add a delayed refresh to catch the correct OS theme
    const timeoutId = setTimeout(refreshTheme, 100)

    // Listen to prefers-color-scheme media query changes
    // On Linux with WebKitGTK 2.42+, this reacts to XDG Desktop Portal
    // color-scheme changes, which works reliably on KDE Plasma and other DEs
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (activeTheme === 'auto') {
        setIsDark(e.matches)
      }
    }
    mediaQuery.addEventListener('change', handleMediaChange)

    // Listen to Tauri native theme events (fallback for platforms where
    // the media query listener may not fire)
    let unlistenTauri: (() => void) | undefined

    if (isPlatformTauri()) {
      import('@tauri-apps/api/event')
        .then(({ listen }) => {
          return listen<string>('theme-changed', (event) => {
            if (activeTheme === 'auto') {
              const isDark = event.payload === 'dark'
              setIsDark(isDark)
            }
          })
        })
        .then((unlisten) => {
          unlistenTauri = unlisten
        })
        .catch((err) => {
          console.error('Failed to setup Tauri theme listener:', err)
        })
    }

    // Clean up
    return () => {
      clearTimeout(timeoutId)
      mediaQuery.removeEventListener('change', handleMediaChange)
      if (unlistenTauri) {
        unlistenTauri()
      }
    }
  }, [activeTheme, setIsDark, setTheme])

  return null
}

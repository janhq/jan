import { useEffect } from 'react'
import { useTheme, checkOSDarkMode } from '@/hooks/useTheme'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * ThemeProvider ensures theme settings are applied on every page load
 * This component should be mounted at the root level of the application
 * It first detects the OS theme preference and applies it accordingly
 */
export function ThemeProvider() {
<<<<<<< HEAD
  const { activeTheme, setIsDark, setTheme } = useTheme()
=======
  const { activeTheme, isDark, setIsDark, setTheme } = useTheme()

  // Apply dark class to root element
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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

<<<<<<< HEAD
    // Listen for changes in OS theme preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleThemeChange = (e: MediaQueryListEvent) => {
      // Only update if theme is set to auto
      if (activeTheme === 'auto') {
        setIsDark(e.matches)
      } else {
        setTheme(activeTheme)
      }
    }

    // Add event listener for browser/web
    mediaQuery.addEventListener('change', handleThemeChange)

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    // Listen to Tauri native theme events (uses XDG Desktop Portal on Linux)
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
<<<<<<< HEAD
      mediaQuery.removeEventListener('change', handleThemeChange)
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      if (unlistenTauri) {
        unlistenTauri()
      }
    }
  }, [activeTheme, setIsDark, setTheme])

  return null
}

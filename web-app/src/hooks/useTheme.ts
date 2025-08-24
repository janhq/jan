import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { isPlatformTauri } from '@/lib/platform'
import type { TauriWindow, TauriWebviewWindow } from '@/types/tauri'

// Dynamic imports for Tauri window APIs
let getCurrentWindow: TauriWindow['getCurrentWindow'] | null = null

// Type adapter for Tauri window
const adaptTauriWindow = (tauriWindow: unknown): TauriWebviewWindow => {
  if (!tauriWindow || typeof tauriWindow !== 'object') {
    console.warn('Invalid Tauri window object, creating no-op adapter')
    // Return no-op functions to prevent runtime errors
    return {
      setTheme: async () => {},
      theme: async () => null
    }
  }
  
  const window = tauriWindow as Record<string, unknown>
  
  return {
    setTheme: (window.setTheme as (theme: 'light' | 'dark' | null) => Promise<void>)?.bind(tauriWindow) || (async () => {}),
    theme: (window.theme as () => Promise<'light' | 'dark' | null>)?.bind(tauriWindow) || (async () => null)
  }
}

if (isPlatformTauri()) {
  import('@tauri-apps/api/window').then(module => {
    getCurrentWindow = () => adaptTauriWindow(module.getCurrentWindow())
  }).catch(() => {
    console.warn('Failed to load Tauri window module')
  })
}

// Function to check if OS prefers dark mode
export const checkOSDarkMode = (): boolean => {
  return (
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export type ThemeState = {
  activeTheme: AppTheme
  setTheme: (theme: AppTheme) => void
  isDark: boolean
  setIsDark: (isDark: boolean) => void
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => {
      // Initialize isDark based on OS preference if theme is auto
      const initialState = {
        activeTheme: 'auto' as AppTheme,
        isDark: checkOSDarkMode(),
        setTheme: async (activeTheme: AppTheme) => {
          if (activeTheme === 'auto') {
            const isDarkMode = checkOSDarkMode()
            if (getCurrentWindow) {
              await getCurrentWindow().setTheme(null)
            }
            set(() => ({ activeTheme, isDark: isDarkMode }))
          } else {
            if (getCurrentWindow) {
              await getCurrentWindow().setTheme(activeTheme)
            }
            set(() => ({ activeTheme, isDark: activeTheme === 'dark' }))
          }
        },
        setIsDark: (isDark: boolean) => set(() => ({ isDark })),
      }

      // Check if we should initialize with dark mode
      if (initialState.activeTheme === 'auto') {
        initialState.isDark = checkOSDarkMode()
      } else {
        initialState.isDark = initialState.activeTheme === 'dark'
      }

      return initialState
    },
    {
      name: localStorageKey.theme,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

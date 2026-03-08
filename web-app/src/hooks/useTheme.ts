import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { ThemeMode } from '@/services/theme/types'
import { localStorageKey } from '@/constants/localStorage'

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
            await getServiceHub().theme().setTheme(null)
            set(() => ({ activeTheme, isDark: isDarkMode }))
          } else {
            await getServiceHub()
              .theme()
              .setTheme(activeTheme as ThemeMode)
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

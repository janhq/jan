import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type DeepResearchState = {
  /**
   * Whether Deep Research mode is enabled for the current session.
   * When enabled, chat completions will use the specialized research prompt.
   */
  enabled: boolean

  /**
   * Toggle Deep Research mode on/off
   */
  toggleDeepResearch: () => void

  /**
   * Set Deep Research mode directly
   */
  setDeepResearch: (enabled: boolean) => void

  /**
   * Reset Deep Research state (e.g., when changing threads)
   */
  resetDeepResearch: () => void
}

export const useDeepResearch = create<DeepResearchState>()(
  persist(
    (set) => ({
      enabled: false,

      toggleDeepResearch: () => {
        set((state) => ({ enabled: !state.enabled }))
      },

      setDeepResearch: (enabled: boolean) => {
        set({ enabled })
      },

      resetDeepResearch: () => {
        set({ enabled: false })
      },
    }),
    {
      name: localStorageKey.deepResearch || 'jan-deep-research',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

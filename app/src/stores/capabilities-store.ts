import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface CapabilitiesState {
  searchEnabled: boolean
  deepResearchEnabled: boolean
  browserEnabled: boolean
  reasoningEnabled: boolean
  setSearchEnabled: (enabled: boolean) => void
  setDeepResearchEnabled: (enabled: boolean) => void
  setBrowserEnabled: (enabled: boolean) => void
  setReasoningEnabled: (enabled: boolean) => void
  toggleSearch: () => void
  toggleDeepResearch: () => void
  toggleBrowser: () => void
  toggleReasoning: () => void
}

export const useCapabilities = create<CapabilitiesState>()(
  persist(
    (set) => ({
      searchEnabled: false,
      browserEnabled: false,
      deepResearchEnabled: false,
      reasoningEnabled: false,
      setSearchEnabled: (enabled: boolean) => set({ searchEnabled: enabled }),
      setDeepResearchEnabled: (enabled: boolean) =>
        set({ deepResearchEnabled: enabled }),
      setBrowserEnabled: (enabled: boolean) =>
        set({ browserEnabled: enabled }),
      setReasoningEnabled: (enabled: boolean) =>
        set({ reasoningEnabled: enabled }),
      toggleSearch: () =>
        set((state) => ({ searchEnabled: !state.searchEnabled })),
      toggleDeepResearch: () =>
        set((state) => ({ deepResearchEnabled: !state.deepResearchEnabled })),
      toggleBrowser: () =>
        set((state) => ({ browserEnabled: !state.browserEnabled })),
      toggleReasoning: () =>
        set((state) => ({ reasoningEnabled: !state.reasoningEnabled })),
    }),
    {
      name: 'capabilities-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

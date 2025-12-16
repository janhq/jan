import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface CapabilitiesState {
  searchEnabled: boolean
  deepResearchEnabled: boolean
  setSearchEnabled: (enabled: boolean) => void
  setDeepResearchEnabled: (enabled: boolean) => void
  toggleSearch: () => void
  toggleDeepResearch: () => void
  thinkingEnabled: boolean
  setThinkingEnabled: (enabled: boolean) => void
  toggleThinking: () => void
}

export const useCapabilities = create<CapabilitiesState>()(
  persist(
    (set) => ({
      searchEnabled: false,
      deepResearchEnabled: false,
      setSearchEnabled: (enabled: boolean) => set({ searchEnabled: enabled }),
      setDeepResearchEnabled: (enabled: boolean) =>
        set({ deepResearchEnabled: enabled }),
      toggleSearch: () =>
        set((state) => ({ searchEnabled: !state.searchEnabled })),
      toggleDeepResearch: () =>
        set((state) => ({ deepResearchEnabled: !state.deepResearchEnabled })),
      thinkingEnabled: false,
      setThinkingEnabled: (enabled: boolean) =>
        set({ thinkingEnabled: enabled }),
      toggleThinking: () =>
        set((state) => ({ thinkingEnabled: !state.thinkingEnabled })),
    }),
    {
      name: 'capabilities-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

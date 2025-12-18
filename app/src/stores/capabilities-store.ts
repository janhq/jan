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
      setSearchEnabled: (enabled: boolean) => {
        set({ searchEnabled: enabled })
        updatePreferencesInBackground({ enable_search: enabled })
      },
      setDeepResearchEnabled: (enabled: boolean) => {
        set({ deepResearchEnabled: enabled })
        updatePreferencesInBackground({ enable_deep_research: enabled })
      },
      setBrowserEnabled: (enabled: boolean) => {
        set({ browserEnabled: enabled })
        updatePreferencesInBackground({ enable_browser: enabled })
      },
      setReasoningEnabled: (enabled: boolean) => {
        set({ reasoningEnabled: enabled })
        updatePreferencesInBackground({ enable_thinking: enabled })
      },
      toggleSearch: () =>
        set((state) => {
          const newValue = !state.searchEnabled
          updatePreferencesInBackground({ enable_search: newValue })
          return { searchEnabled: newValue }
        }),
      toggleDeepResearch: () =>
        set((state) => {
          const newValue = !state.deepResearchEnabled
          updatePreferencesInBackground({ enable_deep_research: newValue })
          return { deepResearchEnabled: newValue }
        }),
      toggleBrowser: () =>
        set((state) => {
          const newValue = !state.browserEnabled
          updatePreferencesInBackground({ enable_browser: newValue })
          return { browserEnabled: newValue }
        }),
      toggleReasoning: () =>
        set((state) => {
          const newValue = !state.reasoningEnabled
          updatePreferencesInBackground({ enable_thinking: newValue })
          return { reasoningEnabled: newValue }
        }),
    }),
    {
      name: 'capabilities-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

// Helper function to update preferences in the background
async function updatePreferencesInBackground(
  preferences: Partial<Preferences>
) {
  try {
    const { useProfile } = await import('./profile-store')
    await useProfile.getState().updatePreferences({ preferences })
  } catch (error) {
    console.error('Failed to update preferences:', error)
  }
}

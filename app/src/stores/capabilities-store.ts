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
  hydrate: (preferences: Partial<Preferences>) => void
}

export const useCapabilities = create<CapabilitiesState>()(
  persist(
    (set) => ({
      searchEnabled: false,
      browserEnabled: false,
      deepResearchEnabled: false,
      reasoningEnabled: false,
      setSearchEnabled: (enabled: boolean) =>
        set((state) => {
          const newState = { ...state, searchEnabled: enabled }
          updatePreferencesInBackground({
            enable_search: newState.searchEnabled,
            enable_browser: newState.browserEnabled,
            enable_deep_research: newState.deepResearchEnabled,
            enable_thinking: newState.reasoningEnabled,
          })
          return { searchEnabled: enabled }
        }),
      setDeepResearchEnabled: (enabled: boolean) =>
        set((state) => {
          const newState = { ...state, deepResearchEnabled: enabled }
          updatePreferencesInBackground({
            enable_search: newState.searchEnabled,
            enable_browser: newState.browserEnabled,
            enable_deep_research: newState.deepResearchEnabled,
            enable_thinking: newState.reasoningEnabled,
          })
          return { deepResearchEnabled: enabled }
        }),
      setBrowserEnabled: (enabled: boolean) =>
        set((state) => {
          const newState = { ...state, browserEnabled: enabled }
          updatePreferencesInBackground({
            enable_search: newState.searchEnabled,
            enable_browser: newState.browserEnabled,
            enable_deep_research: newState.deepResearchEnabled,
            enable_thinking: newState.reasoningEnabled,
          })
          return { browserEnabled: enabled }
        }),
      setReasoningEnabled: (enabled: boolean) =>
        set((state) => {
          const newState = { ...state, reasoningEnabled: enabled }
          updatePreferencesInBackground({
            enable_search: newState.searchEnabled,
            enable_browser: newState.browserEnabled,
            enable_deep_research: newState.deepResearchEnabled,
            enable_thinking: newState.reasoningEnabled,
          })
          return { reasoningEnabled: enabled }
        }),
      toggleSearch: () =>
        set((state) => {
          const newValue = !state.searchEnabled
          updatePreferencesInBackground({
            enable_search: newValue,
            enable_browser: state.browserEnabled,
            enable_deep_research: state.deepResearchEnabled,
            enable_thinking: state.reasoningEnabled,
          })
          return { searchEnabled: newValue }
        }),
      toggleDeepResearch: () =>
        set((state) => {
          const newValue = !state.deepResearchEnabled
          updatePreferencesInBackground({
            enable_search: state.searchEnabled,
            enable_browser: state.browserEnabled,
            enable_deep_research: newValue,
            enable_thinking: state.reasoningEnabled,
          })
          return { deepResearchEnabled: newValue }
        }),
      toggleBrowser: () =>
        set((state) => {
          const newValue = !state.browserEnabled
          updatePreferencesInBackground({
            enable_search: state.searchEnabled,
            enable_browser: newValue,
            enable_deep_research: state.deepResearchEnabled,
            enable_thinking: state.reasoningEnabled,
          })
          return { browserEnabled: newValue }
        }),
      toggleReasoning: () =>
        set((state) => {
          const newValue = !state.reasoningEnabled
          updatePreferencesInBackground({
            enable_search: state.searchEnabled,
            enable_browser: state.browserEnabled,
            enable_deep_research: state.deepResearchEnabled,
            enable_thinking: newValue,
          })
          return { reasoningEnabled: newValue }
        }),
      hydrate: (preferences: Partial<Preferences>) =>
        set({
          searchEnabled: preferences.enable_search ?? false,
          browserEnabled: preferences.enable_browser ?? false,
          deepResearchEnabled: preferences.enable_deep_research ?? false,
          reasoningEnabled: preferences.enable_thinking ?? false,
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

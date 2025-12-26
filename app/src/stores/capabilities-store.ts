import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface CapabilitiesState {
  searchEnabled: boolean
  deepResearchEnabled: boolean
  browserEnabled: boolean
  reasoningEnabled: boolean
  imageGenerationEnabled: boolean
  setSearchEnabled: (enabled: boolean) => void
  setDeepResearchEnabled: (enabled: boolean) => void
  setBrowserEnabled: (enabled: boolean) => void
  setReasoningEnabled: (enabled: boolean) => void
  setImageGenerationEnabled: (enabled: boolean) => void
  toggleSearch: () => void
  toggleDeepResearch: () => void
  toggleBrowser: () => void
  toggleReasoning: () => void
  toggleImageGeneration: () => void
  hydrate: (preferences: Partial<Preferences>) => void
}

export const useCapabilities = create<CapabilitiesState>()(
  persist(
    (set) => ({
      searchEnabled: false,
      browserEnabled: false,
      deepResearchEnabled: false,
      reasoningEnabled: false,
      imageGenerationEnabled: false,
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
      setImageGenerationEnabled: (enabled: boolean) => {
        set({ imageGenerationEnabled: enabled })
      },
      toggleSearch: () =>
        set((state) => {
          const newValue = !state.searchEnabled
          updatePreferencesInBackground({
            enable_search: newValue,
            enable_image_generation: newValue
              ? false
              : state.imageGenerationEnabled,
          })
          return { searchEnabled: newValue }
        }),
      toggleDeepResearch: () =>
        set((state) => {
          const newValue = !state.deepResearchEnabled
          updatePreferencesInBackground({
            enable_deep_research: newValue,
            enable_image_generation: newValue
              ? false
              : state.imageGenerationEnabled,
          })
          return { deepResearchEnabled: newValue }
        }),
      toggleBrowser: () =>
        set((state) => {
          const newValue = !state.browserEnabled
          updatePreferencesInBackground({
            enable_browser: newValue,
            enable_image_generation: newValue
              ? false
              : state.imageGenerationEnabled,
          })
          return { browserEnabled: newValue }
        }),
      toggleReasoning: () =>
        set((state) => {
          const newValue = !state.reasoningEnabled
          updatePreferencesInBackground({
            enable_thinking: newValue,
            enable_image_generation: newValue
              ? false
              : state.imageGenerationEnabled,
          })
          return { reasoningEnabled: newValue }
        }),
      toggleImageGeneration: () =>
        set((state) => {
          const newValue = !state.imageGenerationEnabled
          updatePreferencesInBackground({ enable_image_generation: newValue })
          return { imageGenerationEnabled: newValue }
        }),
      hydrate: (preferences: Partial<Preferences>) =>
        set({
          searchEnabled: preferences.enable_search ?? false,
          browserEnabled: preferences.enable_browser ?? false,
          deepResearchEnabled: preferences.enable_deep_research ?? false,
          reasoningEnabled: preferences.enable_thinking ?? false,
          imageGenerationEnabled: preferences.enable_image_generation ?? false,
        }),
    }),
    {
      name: 'capabilities-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

let pendingPreferences: Partial<Preferences> = {}
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// Helper function to update preferences in the background
async function updatePreferencesInBackground(
  preferences: Partial<Preferences>
) {
  // Merge new preferences into pending
  pendingPreferences = { ...pendingPreferences, ...preferences }

  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  // Set new timer
  debounceTimer = setTimeout(async () => {
    try {
      const { useProfile } = await import('./profile-store')
      const preferencesToUpdate = { ...pendingPreferences }
      pendingPreferences = {} // Reset pending preferences

      await useProfile
        .getState()
        .updatePreferences({ preferences: preferencesToUpdate })
    } catch (error) {
      console.error('Failed to update preferences:', error)
    } finally {
      debounceTimer = null
    }
  }, 100)
}

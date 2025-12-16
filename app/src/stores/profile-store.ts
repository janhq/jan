import { create } from 'zustand'
import { profileService } from '@/services/profile-service'

interface ProfileState {
  settings: ProfileSettingsResponse | null
  isLoading: boolean
  error: string | null
  fetchSettings: () => Promise<void>
  updateSettings: (data: UpdateProfileSettingsRequest) => Promise<void>
  updateProfileSettings: (settings: Partial<ProfileSettings>) => Promise<void>
}

let fetchPromise: Promise<void> | null = null

export const useProfile = create<ProfileState>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    // Return existing promise if already fetching
    if (fetchPromise) {
      return fetchPromise
    }

    fetchPromise = (async () => {
      set({ isLoading: true, error: null })
      try {
        const settings = await profileService.getProfileSettings()
        set({ settings, isLoading: false })
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to fetch settings',
          isLoading: false,
        })
      } finally {
        fetchPromise = null
      }
    })()

    return fetchPromise
  },

  updateSettings: async (data: UpdateProfileSettingsRequest) => {
    const currentSettings = get().settings
    if (!currentSettings) return

    // Optimistic update - update local state immediately
    const optimisticSettings = {
      ...currentSettings,
      ...(data.profile_settings && {
        profile_settings: {
          ...currentSettings.profile_settings,
          ...data.profile_settings,
        },
      }),
      ...(data.memory_config && {
        memory_config: {
          ...currentSettings.memory_config,
          ...data.memory_config,
        },
      }),
      ...(data.advanced_settings && {
        advanced_settings: {
          ...currentSettings.advanced_settings,
          ...data.advanced_settings,
        },
      }),
    }

    set({ settings: optimisticSettings, error: null })

    try {
      // Send to server in background
      await profileService.updateProfileSettings(data)
    } catch (error) {
      // Revert on error
      set({
        settings: currentSettings,
        error: error instanceof Error ? error.message : 'Failed to update settings',
      })
    }
  },

  updateProfileSettings: async (profileSettings: Partial<ProfileSettings>) => {
    const currentSettings = get().settings
    if (!currentSettings) {
      set({ error: 'No settings loaded' })
      return
    }

    const updatedProfileSettings = {
      ...currentSettings.profile_settings,
      ...profileSettings,
    }

    await get().updateSettings({
      profile_settings: updatedProfileSettings,
    })
  },
}))

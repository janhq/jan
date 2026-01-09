import { create } from "zustand";
import { profileService } from "@/services/profile-service";

interface ProfileState {
  settings: ProfileSettingsResponse | null;
  preferences: ProfileSettingsResponse | null;
  isLoading: boolean;
  error: string | null;
  fetchSettings: () => Promise<void>;
  fetchPreferences: () => Promise<ProfileSettingsResponse | null>;
  updateSettings: (data: UpdateProfileSettingsRequest) => Promise<void>;
  updatePreferences: (data: UpdateProfileSettingsRequest) => Promise<void>;
  updateProfileSettings: (settings: Partial<ProfileSettings>) => Promise<void>;
}

let fetchPromise: Promise<void> | null = null;
let fetchPreferencesPromise: Promise<ProfileSettingsResponse | null> | null =
  null;

export const useProfile = create<ProfileState>((set, get) => ({
  settings: null,
  preferences: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    // Return existing promise if already fetching
    if (fetchPromise) {
      return fetchPromise;
    }

    fetchPromise = (async () => {
      set({ isLoading: true, error: null });
      try {
        const settings = await profileService.getProfileSettings();
        set({ settings, isLoading: false });
      } catch (error) {
        set({
          error:
            error instanceof Error ? error.message : "Failed to fetch settings",
          isLoading: false,
        });
      } finally {
        fetchPromise = null;
      }
    })();

    return fetchPromise;
  },

  fetchPreferences: async () => {
    // Return existing promise if already fetching
    if (fetchPreferencesPromise) {
      return fetchPreferencesPromise;
    }

    fetchPreferencesPromise = (async () => {
      set({ isLoading: true, error: null });
      try {
        const preferences = await profileService.getPreferences();
        set({ preferences, isLoading: false });
        return preferences;
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch preferences",
          isLoading: false,
        });
        return null;
      } finally {
        fetchPreferencesPromise = null;
      }
    })();

    return fetchPreferencesPromise;
  },

  updateSettings: async (data: UpdateProfileSettingsRequest) => {
    const currentSettings = get().settings;
    if (!currentSettings) return;

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
    };

    set({ settings: optimisticSettings, error: null });

    try {
      // Send to server in background
      await profileService.updateProfileSettings(data);
    } catch (error) {
      // Revert on error
      set({
        settings: currentSettings,
        error:
          error instanceof Error ? error.message : "Failed to update settings",
      });
    }
  },

  updatePreferences: async (data: UpdateProfileSettingsRequest) => {
    const currentPreferences = get().preferences;
    if (!currentPreferences) return;

    // Optimistic update - update local state immediately
    const optimisticPreferences = {
      ...currentPreferences,
      ...(data.profile_settings && {
        profile_settings: {
          ...currentPreferences.profile_settings,
          ...data.profile_settings,
        },
      }),
      ...(data.memory_config && {
        memory_config: {
          ...currentPreferences.memory_config,
          ...data.memory_config,
        },
      }),
      ...(data.advanced_settings && {
        advanced_settings: {
          ...currentPreferences.advanced_settings,
          ...data.advanced_settings,
        },
      }),
      ...(data.preferences && {
        preferences: {
          ...currentPreferences.preferences,
          ...data.preferences,
        },
      }),
    };

    set({ preferences: optimisticPreferences, error: null });

    try {
      // Send to server in background
      await profileService.updatePreferences(data);
    } catch (error) {
      // Revert on error
      set({
        preferences: currentPreferences,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update preferences",
      });
    }
  },

  updateProfileSettings: async (profileSettings: Partial<ProfileSettings>) => {
    const currentSettings = get().settings;
    if (!currentSettings) {
      set({ error: "No settings loaded" });
      return;
    }

    const updatedProfileSettings = {
      ...currentSettings.profile_settings,
      ...profileSettings,
    };

    await get().updateSettings({
      profile_settings: updatedProfileSettings,
    });
  },
}));

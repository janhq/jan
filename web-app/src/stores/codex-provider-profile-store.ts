import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type CodexProviderProfile = {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKeyEnv?: string
  codexHome: string
  providerType: 'openai-compatible' | 'ollama' | 'llama-cpp' | 'custom'
  createdAt: number
  updatedAt: number
}

type CodexProviderProfileDraft = Omit<
  CodexProviderProfile,
  'id' | 'createdAt' | 'updatedAt'
>

type CodexProviderProfileState = {
  profiles: Record<string, CodexProviderProfile>
  activeProfileId: string | null
  upsertProfile: (
    profile: CodexProviderProfileDraft & { id?: string }
  ) => CodexProviderProfile
  removeProfile: (profileId: string) => void
  setActiveProfile: (profileId: string | null) => void
}

const createProfileId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

export const useCodexProviderProfiles =
  create<CodexProviderProfileState>()(
    persist(
      (set, get) => ({
        profiles: {},
        activeProfileId: null,

        upsertProfile: (profile) => {
          const now = Date.now()
          const existing = profile.id ? get().profiles[profile.id] : undefined
          const next: CodexProviderProfile = {
            id: profile.id ?? createProfileId(),
            name: profile.name,
            baseUrl: profile.baseUrl,
            model: profile.model,
            apiKeyEnv: profile.apiKeyEnv,
            codexHome: profile.codexHome,
            providerType: profile.providerType,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          }

          set((state) => ({
            profiles: {
              ...state.profiles,
              [next.id]: next,
            },
            activeProfileId: state.activeProfileId ?? next.id,
          }))

          return next
        },

        removeProfile: (profileId) => {
          set((state) => {
            const profiles = { ...state.profiles }
            delete profiles[profileId]
            const activeProfileId =
              state.activeProfileId === profileId
                ? Object.keys(profiles)[0] ?? null
                : state.activeProfileId
            return { profiles, activeProfileId }
          })
        },

        setActiveProfile: (activeProfileId) => set({ activeProfileId }),
      }),
      {
        name: localStorageKey.codexProviderProfiles,
        storage: createJSONStorage(() => localStorage),
      }
    )
  )

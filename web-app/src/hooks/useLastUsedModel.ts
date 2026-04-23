import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'

interface LastUsedModelState {
  provider: string | null
  model: string | null
  setLastUsedModel: (provider: string, model: string) => void
  clear: () => void
}

// Replaces direct localStorage access for the last-used-model key across
// DropdownModelProvider, ChatInput, SetupScreen, and getModelToStart.
export const useLastUsedModel = create<LastUsedModelState>()(
  persist(
    (set) => ({
      provider: null,
      model: null,
      setLastUsedModel: (provider, model) => set({ provider, model }),
      clear: () => set({ provider: null, model: null }),
    }),
    {
      name: localStorageKey.lastUsedModel,
      storage: createJSONStorage(() => fileStorage),
    }
  )
)

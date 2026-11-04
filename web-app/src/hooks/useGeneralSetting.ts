import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { HUGGINGFACE_TOKEN_SECRET_KEY } from '@janhq/core'

type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  tokenCounterCompact: boolean
  autoUpdateCheck: boolean
  stripReasoningFromContext: boolean
  huggingfaceToken?: string
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setAutoUpdateCheck: (value: boolean) => void
  setStripReasoningFromContext: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      autoUpdateCheck: true,
      stripReasoningFromContext: false,
      huggingfaceToken: undefined,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
      setAutoUpdateCheck: (value) => set({ autoUpdateCheck: value }),
      setStripReasoningFromContext: (value) =>
        set({ stripReasoningFromContext: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
      setHuggingfaceToken: (token) => {
        set({ huggingfaceToken: token })
        // The OS keyring is the only copy; downloads read it from there.
        getServiceHub()
          .core()
          .invoke('set_secret', {
            key: HUGGINGFACE_TOKEN_SECRET_KEY,
            value: token,
          })
          .catch((err) =>
            console.warn('Failed to persist huggingface token to keyring:', err)
          )
      },
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
      // huggingfaceToken is a secret — kept in the OS keyring, never persisted here.
      partialize: (state) => ({
        currentLanguage: state.currentLanguage,
        spellCheckChatInput: state.spellCheckChatInput,
        tokenCounterCompact: state.tokenCounterCompact,
        autoUpdateCheck: state.autoUpdateCheck,
        stripReasoningFromContext: state.stripReasoningFromContext,
      }),
    }
  )
)



import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { HUGGINGFACE_TOKEN_SECRET_KEY } from '@janhq/core'

type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  autoUpdateCheck: boolean
  closeToTray: boolean
  stripReasoningFromContext: boolean
  huggingfaceToken?: string
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setAutoUpdateCheck: (value: boolean) => void
  setCloseToTray: (value: boolean) => void
  setStripReasoningFromContext: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      autoUpdateCheck: true,
      closeToTray: false,
      stripReasoningFromContext: false,
      huggingfaceToken: undefined,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setAutoUpdateCheck: (value) => set({ autoUpdateCheck: value }),
      setCloseToTray: (value) => set({ closeToTray: value }),
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
        autoUpdateCheck: state.autoUpdateCheck,
        closeToTray: state.closeToTray,
        stripReasoningFromContext: state.stripReasoningFromContext,
      }),
    }
  )
)



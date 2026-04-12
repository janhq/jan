import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'
import { ExtensionManager } from '@/lib/extension'
type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  tokenCounterCompact: boolean
  huggingfaceToken?: string
  setupCompleted: boolean
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
  setSetupCompleted: (value: boolean) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
      setupCompleted: false,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
      setSetupCompleted: (value) => set({ setupCompleted: value }),
      setHuggingfaceToken: (token) => {
        set({ huggingfaceToken: token })
        ExtensionManager.getInstance()
          .getByName('@janhq/download-extension')
          ?.getSettings()
          .then((settings) => {
            if (settings) {
              const newSettings = settings.map((e) => {
                if (e.key === 'hf-token') {
                  e.controllerProps.value = token
                }
                return e
              })
              ExtensionManager.getInstance()
                .getByName('@janhq/download-extension')
                ?.updateSettings(newSettings)
            }
          })
      },
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: createJSONStorage(() => fileStorage),
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Partial<GeneralSettingState>
        if (version < 1) {
          // Existing users already have persisted data, so they must have
          // completed setup. Without this migration they would rehydrate
          // with the default (false) and lose the ability to delete the
          // "What is Jan?" thread.
          state.setupCompleted = true
        }
        return state as GeneralSettingState
      },
    }
  )
)



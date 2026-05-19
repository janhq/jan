import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { ExtensionManager } from '@/lib/extension'
export type ReasoningBudgetLevel =
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'unlimited'

type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  tokenCounterCompact: boolean
  disableReasoning: boolean
  reasoningBudget: ReasoningBudgetLevel
  preloadModelOnStartup: boolean
  huggingfaceToken?: string
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setDisableReasoning: (value: boolean) => void
  setReasoningBudget: (value: ReasoningBudgetLevel) => void
  setPreloadModelOnStartup: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      disableReasoning: true,
      reasoningBudget: 'medium',
      preloadModelOnStartup: true,
      huggingfaceToken: undefined,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
      setDisableReasoning: (value) => set({ disableReasoning: value }),
      setReasoningBudget: (value) => set({ reasoningBudget: value }),
      setPreloadModelOnStartup: (value) => set({ preloadModelOnStartup: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
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
      storage: createJSONStorage(() => localStorage),
    }
  )
)

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { ExtensionManager } from '@/lib/extension'

// Default browser extension ID from Chrome Web Store
const DEFAULT_BROWSER_EXTENSION_ID = 'mkciifcjehgnpaigoiaakdgabbpfppal'

type GeneralSettingState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  tokenCounterCompact: boolean
  huggingfaceToken?: string
  browserExtensionId: string
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
  setBrowserExtensionId: (id: string) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
      browserExtensionId: DEFAULT_BROWSER_EXTENSION_ID,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
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
      setBrowserExtensionId: (id) => set({ browserExtensionId: id }),
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: createJSONStorage(() => localStorage),
    }
  )
)



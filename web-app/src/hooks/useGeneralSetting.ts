import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  experimentalFeatures: boolean
  setExperimentalFeatures: (value: boolean) => void
  setSpellCheckChatInput: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
}

export const useGeneralSetting = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      experimentalFeatures: false,
      setExperimentalFeatures: (value) => set({ experimentalFeatures: value }),
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
    }),
    {
      name: localStorageKey.settingGeneral,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

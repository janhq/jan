import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  currentLanguage: Language
  spellCheckChatInput: boolean
  setSpellCheckChatInput: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
}

export const useGeneralSetting = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
    }),
    {
      name: localStoregeKey.settingGeneral,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

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
  /** Desktop Tauri: global shortcut → capture screen → OCR → chat (opt-in). */
  screenCaptureToTextEnabled: boolean
  /** Tauri global-shortcut format, e.g. CommandOrControl+Shift+KeyS */
  screenCaptureShortcut: string
  /** Optional text prepended before OCR result when inserting into the composer. */
  screenCaptureInstructionTemplate: string
  /** Small always-on-top toolbar (separate window) for capture modes. */
  screenCaptureFloatingToolbarEnabled: boolean
  /**
   * Tesseract language(s): `auto` follows app UI language, or e.g. `jpn`, `chi_sim+eng`.
   * @see web-app/src/lib/screenCaptureOcrTesseract.ts
   */
  screenCaptureOcrTesseractLang: string
  setHuggingfaceToken: (token: string) => void
  setSpellCheckChatInput: (value: boolean) => void
  setTokenCounterCompact: (value: boolean) => void
  setCurrentLanguage: (value: Language) => void
  setScreenCaptureToTextEnabled: (value: boolean) => void
  setScreenCaptureShortcut: (value: string) => void
  setScreenCaptureInstructionTemplate: (value: string) => void
  setScreenCaptureFloatingToolbarEnabled: (value: boolean) => void
  setScreenCaptureOcrTesseractLang: (value: string) => void
}

export const useGeneralSetting = create<GeneralSettingState>()(
  persist(
    (set) => ({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
      screenCaptureToTextEnabled: false,
      screenCaptureShortcut: 'CommandOrControl+Shift+KeyS',
      screenCaptureInstructionTemplate: '',
      screenCaptureFloatingToolbarEnabled: false,
      screenCaptureOcrTesseractLang: 'auto',
      setSpellCheckChatInput: (value) => set({ spellCheckChatInput: value }),
      setTokenCounterCompact: (value) => set({ tokenCounterCompact: value }),
      setCurrentLanguage: (value) => set({ currentLanguage: value }),
      setScreenCaptureToTextEnabled: (value) =>
        set({ screenCaptureToTextEnabled: value }),
      setScreenCaptureShortcut: (value) => set({ screenCaptureShortcut: value }),
      setScreenCaptureInstructionTemplate: (value) =>
        set({ screenCaptureInstructionTemplate: value }),
      setScreenCaptureFloatingToolbarEnabled: (value) =>
        set({ screenCaptureFloatingToolbarEnabled: value }),
      setScreenCaptureOcrTesseractLang: (value) =>
        set({ screenCaptureOcrTesseractLang: value }),
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
    }
  )
)



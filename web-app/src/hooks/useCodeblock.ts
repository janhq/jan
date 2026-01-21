import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type CodeBlockStyle = string

interface CodeBlockState {
  codeBlockStyle: CodeBlockStyle
  showLineNumbers: boolean
  setCodeBlockStyle: (style: CodeBlockStyle) => void
  setShowLineNumbers: (show: boolean) => void
  resetCodeBlockStyle: () => void
}

const defaultCodeBlockStyle: CodeBlockStyle = 'github-light'
const defaultShowLineNumbers: boolean = true

export const useCodeblock = create<CodeBlockState>()(
  persist(
    (set) => {
      return {
        codeBlockStyle: defaultCodeBlockStyle,
        showLineNumbers: defaultShowLineNumbers,

        setCodeBlockStyle: (style: CodeBlockStyle) => {
          set({ codeBlockStyle: style })
        },

        setShowLineNumbers: (show: boolean) => {
          set({ showLineNumbers: show })
        },

        resetCodeBlockStyle: () => {
          set({
            codeBlockStyle: defaultCodeBlockStyle,
            showLineNumbers: defaultShowLineNumbers,
          })
        },
      }
    },
    {
      name: localStorageKey.settingCodeBlock,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

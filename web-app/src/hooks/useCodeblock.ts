import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

export type CodeBlockStyle = string

interface CodeBlockState {
  codeBlockStyle: CodeBlockStyle
  showLineNumbers: boolean
  setCodeBlockStyle: (style: CodeBlockStyle) => void
  setShowLineNumbers: (show: boolean) => void
  resetCodeBlockStyle: () => void
}

const defaultCodeBlockStyle: CodeBlockStyle = 'dracula'
const defaultShowLineNumbers: boolean = true

export const useCodeblock = create<CodeBlockState>()(
  persist(
    (set) => {
      return {
        codeBlockStyle: defaultCodeBlockStyle,
        showLineNumbers: defaultShowLineNumbers,

        setCodeBlockStyle: (style: CodeBlockStyle) => {
          // Update state
          set({ codeBlockStyle: style })
        },

        setShowLineNumbers: (show: boolean) => {
          // Update state
          set({ showLineNumbers: show })
        },

        resetCodeBlockStyle: () => {
          // Update state
          set({
            codeBlockStyle: defaultCodeBlockStyle,
            showLineNumbers: defaultShowLineNumbers,
          })
        },
      }
    },
    {
      name: localStoregeKey.settingCodeBlock,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

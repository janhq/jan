import { create } from 'zustand'

type PromptStoreState = {
  prompt: string
  setPrompt: (value: string) => void
  resetPrompt: () => void
}

export const usePrompt = create<PromptStoreState>((set) => ({
  prompt: '',
  setPrompt: (value) => set({ prompt: value }),
  resetPrompt: () => set({ prompt: '' }),
}))

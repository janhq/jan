import { create } from 'zustand'

const MAX_HISTORY_SIZE = 100

type PromptStoreState = {
  prompt: string
  setPrompt: (value: string) => void
  resetPrompt: () => void

  // Prompt history for up/down arrow navigation
  promptHistory: string[]
  historyIndex: number
  draftPrompt: string
  addToHistory: (value: string) => void
  navigateHistory: (direction: 'up' | 'down') => void
  resetHistoryNavigation: () => void
}

export const usePrompt = create<PromptStoreState>((set, get) => ({
  prompt: '',
  setPrompt: (value) => {
    set({ prompt: value })
    // Reset history navigation when user types manually
    if (get().historyIndex !== -1) {
      set({ historyIndex: -1 })
    }
  },
  resetPrompt: () => set({ prompt: '' }),

  // History state
  promptHistory: [],
  historyIndex: -1,
  draftPrompt: '',

  addToHistory: (value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const { promptHistory } = get()
    // Avoid consecutive duplicates
    if (promptHistory.length > 0 && promptHistory[0] === trimmed) return
    set({
      promptHistory: [trimmed, ...promptHistory].slice(0, MAX_HISTORY_SIZE),
      historyIndex: -1,
    })
  },

  navigateHistory: (direction) => {
    const { promptHistory, historyIndex, prompt, draftPrompt } = get()
    if (promptHistory.length === 0) return

    if (direction === 'up') {
      const nextIndex = historyIndex + 1
      if (nextIndex >= promptHistory.length) return
      // Save current input as draft when first entering history
      const newDraft = historyIndex === -1 ? prompt : draftPrompt
      set({
        historyIndex: nextIndex,
        draftPrompt: newDraft,
        prompt: promptHistory[nextIndex],
      })
    } else {
      // direction === 'down'
      if (historyIndex <= -1) return
      const nextIndex = historyIndex - 1
      if (nextIndex === -1) {
        // Restore draft
        set({
          historyIndex: -1,
          prompt: draftPrompt,
        })
      } else {
        set({
          historyIndex: nextIndex,
          prompt: promptHistory[nextIndex],
        })
      }
    }
  },

  resetHistoryNavigation: () => set({ historyIndex: -1, draftPrompt: '' }),
}))

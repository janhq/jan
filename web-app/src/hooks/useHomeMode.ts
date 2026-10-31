import { create } from 'zustand'

/**
 * What the next conversation started from the home composer will be. In memory
 * only: a new window starts in Chat, and a started conversation lives in its own
 * view, so the mode is fixed for the conversation once it begins.
 */
export type HomeMode = 'chat' | 'cowork'

type HomeModeState = {
  mode: HomeMode
  setMode: (mode: HomeMode) => void
}

export const useHomeMode = create<HomeModeState>()((set) => ({
  mode: 'chat',
  setMode: (mode) => set({ mode }),
}))

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThinkingLevel = 'Max' | 'High' | 'Medium' | 'Low' | 'None'

type ThinkingLevelState = {
  thinkingLevel: ThinkingLevel
  setThinkingLevel: (level: ThinkingLevel) => void
}

export const useThinkingLevel = create<ThinkingLevelState>()(
  persist(
    (set) => ({
      thinkingLevel: 'Low',
      setThinkingLevel: (level) => set({ thinkingLevel: level }),
    }),
    { name: 'thinking-level' }
  )
)

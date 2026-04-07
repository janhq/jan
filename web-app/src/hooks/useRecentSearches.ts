import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'

const MAX_ENTRIES = 5

interface RecentSearchesState {
  threadIds: string[]
  addSearch: (threadId: string) => void
  clearSearches: () => void
}

export const useRecentSearches = create<RecentSearchesState>()(
  persist(
    (set, get) => ({
      threadIds: [],

      addSearch: (threadId) => {
        const deduped = get().threadIds.filter((id) => id !== threadId)
        set({ threadIds: [threadId, ...deduped].slice(0, MAX_ENTRIES) })
      },

      clearSearches: () => set({ threadIds: [] }),
    }),
    {
      name: localStorageKey.recentSearches,
      storage: createJSONStorage(() => fileStorage),
    }
  )
)

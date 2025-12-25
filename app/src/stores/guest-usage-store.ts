import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface GuestUsageState {
  count: number
  limit: number
  increment: () => void
  reset: () => void
}

const DEFAULT_LIMIT = 3

export const useGuestUsage = create<GuestUsageState>()(
  persist(
    (set) => ({
      count: 0,
      limit: DEFAULT_LIMIT,
      increment: () =>
        set((state) => ({
          count: Math.min(state.count + 1, state.limit),
        })),
      reset: () => set({ count: 0, limit: DEFAULT_LIMIT }),
    }),
    {
      name: 'guest-usage-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ count: state.count }),
    }
  )
)

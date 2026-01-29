import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  open: boolean
  size: number
  width: string // Sidebar width in rem (e.g., "15rem")
  setLeftPanel: (value: boolean) => void
  setLeftPanelSize: (value: number) => void
  setLeftPanelWidth: (value: string) => void
}

export const useLeftPanel = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      open: true,
      size: 20, // Default size of 20%
      width: '15rem', // Default sidebar width
      setLeftPanel: (value) => set({ open: value }),
      setLeftPanelSize: (value) => set({ size: value }),
      setLeftPanelWidth: (value) => set({ width: value }),
    }),
    {
      name: localStorageKey.LeftPanel,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

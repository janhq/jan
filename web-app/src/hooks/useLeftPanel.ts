import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  open: boolean
  size: number
  setLeftPanel: (value: boolean) => void
  setLeftPanelSize: (value: number) => void
}

export const useLeftPanel = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      open: true,
      size: 20, // Default size of 20%
      setLeftPanel: (value) => set({ open: value }),
      setLeftPanelSize: (value) => set({ size: value }),
    }),
    {
      name: localStorageKey.LeftPanel,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

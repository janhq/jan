import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStoregeKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  open: boolean
  setLeftPanel: (value: boolean) => void
}

export const useLeftPanel = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      open: true,
      setLeftPanel: (value) => set({ open: value }),
    }),
    {
      name: localStoregeKey.LeftPanel,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

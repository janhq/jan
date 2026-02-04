import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  open: boolean
  size: number
<<<<<<< HEAD
  setLeftPanel: (value: boolean) => void
  setLeftPanelSize: (value: number) => void
=======
  width: string // Sidebar width in rem (e.g., "15rem")
  setLeftPanel: (value: boolean) => void
  setLeftPanelSize: (value: number) => void
  setLeftPanelWidth: (value: string) => void
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}

export const useLeftPanel = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      open: true,
      size: 20, // Default size of 20%
<<<<<<< HEAD
      setLeftPanel: (value) => set({ open: value }),
      setLeftPanelSize: (value) => set({ size: value }),
=======
      width: '15rem', // Default sidebar width
      setLeftPanel: (value) => set({ open: value }),
      setLeftPanelSize: (value) => set({ size: value }),
      setLeftPanelWidth: (value) => set({ width: value }),
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    }),
    {
      name: localStorageKey.LeftPanel,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

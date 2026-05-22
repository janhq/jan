import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type LeftPanelStoreState = {
  open: boolean
  size: number
  width: string // Sidebar width in rem (e.g., "15rem")
  projectExpanded: Record<string, boolean>
  setLeftPanel: (value: boolean) => void
  setLeftPanelSize: (value: number) => void
  setLeftPanelWidth: (value: string) => void
  setProjectExpanded: (projectId: string, expanded: boolean) => void
}

export const useLeftPanel = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      open: false,
      size: 20, // Default size of 20%
      width: '15rem', // Default sidebar width
      projectExpanded: {},
      setLeftPanel: (value) => set({ open: value }),
      setLeftPanelSize: (value) => set({ size: value }),
      setLeftPanelWidth: (value) => set({ width: value }),
      setProjectExpanded: (projectId, expanded) =>
        set((state) => ({
          projectExpanded: {
            ...state.projectExpanded,
            [projectId]: expanded,
          },
        })),
    }),
    {
      name: localStorageKey.LeftPanel,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

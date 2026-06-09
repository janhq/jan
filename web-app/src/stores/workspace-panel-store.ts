import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { localStorageKey } from '@/constants/localStorage'

export type WorkspaceBottomPanelSection = 'terminal' | 'browser'

type WorkspacePanelState = {
  bottomOpen: boolean
  bottomHeight: string
  bottomSection: WorkspaceBottomPanelSection
  toggleBottomPanel: () => void
  setBottomOpen: (open: boolean) => void
  setBottomHeight: (height: string) => void
  setBottomSection: (section: WorkspaceBottomPanelSection) => void
}

const panelStorage = createJSONStorage<
  Pick<WorkspacePanelState, 'bottomOpen' | 'bottomHeight' | 'bottomSection'>
>(() => localStorage)

export const useWorkspacePanel = create<WorkspacePanelState>()(
  persist(
    (set) => ({
      bottomOpen: false,
      bottomHeight: '18rem',
      bottomSection: 'terminal',
      toggleBottomPanel: () =>
        set((state) => ({ bottomOpen: !state.bottomOpen })),
      setBottomOpen: (bottomOpen) => set({ bottomOpen }),
      setBottomHeight: (bottomHeight) => set({ bottomHeight }),
      setBottomSection: (bottomSection) =>
        set({ bottomOpen: true, bottomSection }),
    }),
    {
      name: localStorageKey.workspacePanel,
      storage: panelStorage,
      partialize: (state) => ({
        bottomOpen: state.bottomOpen,
        bottomHeight: state.bottomHeight,
        bottomSection: state.bottomSection,
      }),
    }
  )
)

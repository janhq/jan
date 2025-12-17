import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SidebarState {
  isOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isOpen: true,
      toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
      setSidebarOpen: (open: boolean) => set({ isOpen: open }),
    }),
    {
      name: 'sidebar-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

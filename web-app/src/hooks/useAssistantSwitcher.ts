import { create } from 'zustand'

interface AssistantSwitcherState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  // Registered by the mounted switcher so the global Cmd/Ctrl+J shortcut can
  // advance to the next assistant without reaching into the component tree.
  cycleHandler: (() => void) | null
  setCycleHandler: (fn: (() => void) | null) => void
}

export const useAssistantSwitcher = create<AssistantSwitcherState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  cycleHandler: null,
  setCycleHandler: (fn) => set({ cycleHandler: fn }),
}))

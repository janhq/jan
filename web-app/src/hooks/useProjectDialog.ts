import { create } from 'zustand'

type ProjectDialogState = {
  open: boolean
  setOpen: (value: boolean) => void
}

export const useProjectDialog = create<ProjectDialogState>()((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}))

import { create } from 'zustand'

type SearchDialogState = {
  open: boolean
  setOpen: (value: boolean) => void
}

export const useSearchDialog = create<SearchDialogState>()((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}))

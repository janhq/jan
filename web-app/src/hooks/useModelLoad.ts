import { create } from 'zustand'

type ModelLoadState = {
  modelLoadError?: string
  setModelLoadError: (error: string | undefined) => void
}

export const useModelLoad = create<ModelLoadState>()((set) => ({
  modelLoadError: undefined,
  setModelLoadError: (error) => set({ modelLoadError: error }),
}))

import { create } from 'zustand'

type ModelLoadState = {
  modelLoadError?: string | ErrorObject
  setModelLoadError: (error: string | ErrorObject | undefined) => void
}

export const useModelLoad = create<ModelLoadState>()((set) => ({
  modelLoadError: undefined,
  setModelLoadError: (error) => set({ modelLoadError: error }),
}))

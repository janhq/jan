import { create } from 'zustand'

interface AnimationState {
  sidebarAnimated: boolean
  modelSelectorAnimated: boolean
  setSidebarAnimated: () => void
  setModelSelectorAnimated: () => void
}

export const useAnimationStore = create<AnimationState>()((set) => ({
  sidebarAnimated: false,
  modelSelectorAnimated: false,
  setSidebarAnimated: () => set({ sidebarAnimated: true }),
  setModelSelectorAnimated: () => set({ modelSelectorAnimated: true }),
}))

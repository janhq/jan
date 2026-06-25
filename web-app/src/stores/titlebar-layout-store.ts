import { create } from 'zustand'

export type ButtonId = 'minimize' | 'maximize' | 'close'
export type TitlebarLayout = { left: ButtonId[]; right: ButtonId[] }

export const DEFAULT_TITLEBAR_LAYOUT: TitlebarLayout = {
  left: [],
  right: ['minimize', 'maximize', 'close'],
}

type TitlebarLayoutState = {
  layout: TitlebarLayout
  setLayout: (layout: TitlebarLayout) => void
}

export const useTitlebarLayout = create<TitlebarLayoutState>()((set) => ({
  layout: DEFAULT_TITLEBAR_LAYOUT,
  setLayout: (layout) => set({ layout }),
}))

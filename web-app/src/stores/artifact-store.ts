import { create } from 'zustand'

/**
 * Drives the side panel that hosts the live HTML artifact preview.
 *
 * Only one artifact is shown at a time. Each inline trigger owns a stable
 * `sourceId`; `update` is a no-op unless it targets the artifact currently
 * bound to the panel, so a streaming message can keep the open preview in
 * sync without other artifacts hijacking the panel.
 */
type ArtifactState = {
  isOpen: boolean
  sourceId: string | null
  code: string
  title: string
  open: (sourceId: string, code: string, title?: string) => void
  update: (sourceId: string, code: string) => void
  close: () => void
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  isOpen: false,
  sourceId: null,
  code: '',
  title: 'HTML',
  open: (sourceId, code, title = 'HTML') =>
    set({ isOpen: true, sourceId, code, title }),
  update: (sourceId, code) => {
    const state = get()
    if (!state.isOpen || state.sourceId !== sourceId || state.code === code) {
      return
    }
    set({ code })
  },
  close: () => set({ isOpen: false, sourceId: null, code: '' }),
}))

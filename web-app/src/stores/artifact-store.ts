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
  streaming: boolean
  open: (sourceId: string, code: string, streaming?: boolean) => void
  update: (sourceId: string, code: string, streaming?: boolean) => void
  close: () => void
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  isOpen: false,
  sourceId: null,
  code: '',
  title: 'HTML',
  streaming: false,
  open: (sourceId, code, streaming = false) =>
    set({ isOpen: true, sourceId, code, streaming }),
  update: (sourceId, code, streaming) => {
    const state = get()
    if (!state.isOpen || state.sourceId !== sourceId) return
    const next: Partial<ArtifactState> = {}
    if (state.code !== code) next.code = code
    if (streaming !== undefined && state.streaming !== streaming) {
      next.streaming = streaming
    }
    if (Object.keys(next).length > 0) set(next)
  },
  close: () => set({ isOpen: false, sourceId: null, code: '', streaming: false }),
}))

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type AttachmentsSettings = {
  enabled: boolean
  maxFileSizeMB: number
  retrievalLimit: number
  retrievalThreshold: number
  chunkSizeTokens: number
  overlapTokens: number
}

type AttachmentsStore = AttachmentsSettings & {
  setEnabled: (v: boolean) => void
  setMaxFileSizeMB: (v: number) => void
  setRetrievalLimit: (v: number) => void
  setRetrievalThreshold: (v: number) => void
  setChunkSizeTokens: (v: number) => void
  setOverlapTokens: (v: number) => void
}

export const useAttachments = create<AttachmentsStore>()(
  persist(
    (set) => ({
      enabled: true,
      maxFileSizeMB: 20,
      retrievalLimit: 3,
      retrievalThreshold: 0.5,
      chunkSizeTokens: 512,
      overlapTokens: 64,
      setEnabled: (v) => set({ enabled: v }),
      setMaxFileSizeMB: (v) => set({ maxFileSizeMB: Math.max(1, Math.min(200, Math.floor(v))) }),
      setRetrievalLimit: (v) => set({ retrievalLimit: Math.max(1, Math.min(20, Math.floor(v))) }),
      setRetrievalThreshold: (v) => set({ retrievalThreshold: Math.max(0, Math.min(1, v)) }),
      setChunkSizeTokens: (v) => set({ chunkSizeTokens: Math.max(64, Math.min(8192, Math.floor(v))) }),
      setOverlapTokens: (v) => set({ overlapTokens: Math.max(0, Math.min(1024, Math.floor(v))) }),
    }),
    {
      name: `${localStorageKey.settingGeneral}-attachments`,
      storage: createJSONStorage(() => localStorage),
    }
  )
)


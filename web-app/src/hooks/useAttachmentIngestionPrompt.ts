import { Attachment } from '@/types/attachment'
import { create } from 'zustand'

type AttachmentSummary = Pick<Attachment, 'name' | 'size'>

type AttachmentIngestionState = {
  isModalOpen: boolean
  attachments: AttachmentSummary[]
  sizeThreshold: number
  resolver: ((choice: 'inline' | 'embeddings' | undefined) => void) | null
  showPrompt: (
    attachments: AttachmentSummary[],
    sizeThreshold: number
  ) => Promise<'inline' | 'embeddings' | undefined>
  choose: (choice: 'inline' | 'embeddings') => void
  cancel: () => void
}

export const useAttachmentIngestionPrompt = create<AttachmentIngestionState>()(
  (set, get) => ({
    isModalOpen: false,
    attachments: [],
    sizeThreshold: 0,
    resolver: null,
    showPrompt: async (attachments, sizeThreshold) => {
      return new Promise<'inline' | 'embeddings' | undefined>((resolve) => {
        set({
          isModalOpen: true,
          attachments,
          sizeThreshold,
          resolver: resolve,
        })
      })
    },
    choose: (choice) => {
      const { resolver } = get()
      resolver?.(choice)
      set({ isModalOpen: false, attachments: [], resolver: null })
    },
    cancel: () => {
      const { resolver } = get()
      resolver?.(undefined)
      set({ isModalOpen: false, attachments: [], resolver: null })
    },
  })
)

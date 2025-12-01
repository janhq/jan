import { Attachment } from '@/types/attachment'
import { create } from 'zustand'

type AttachmentSummary = Pick<Attachment, 'name' | 'size'>

type AttachmentIngestionState = {
  isModalOpen: boolean
  currentAttachment: AttachmentSummary | null
  currentIndex: number
  totalCount: number
  sizeThreshold: number
  resolver: ((choice: 'inline' | 'embeddings' | undefined) => void) | null
  showPrompt: (
    attachment: AttachmentSummary,
    sizeThreshold: number,
    currentIndex: number,
    totalCount: number
  ) => Promise<'inline' | 'embeddings' | undefined>
  choose: (choice: 'inline' | 'embeddings') => void
  cancel: () => void
}

export const useAttachmentIngestionPrompt = create<AttachmentIngestionState>()(
  (set, get) => ({
    isModalOpen: false,
    currentAttachment: null,
    currentIndex: 0,
    totalCount: 0,
    sizeThreshold: 0,
    resolver: null,
    showPrompt: async (attachment, sizeThreshold, currentIndex, totalCount) => {
      return new Promise<'inline' | 'embeddings' | undefined>((resolve) => {
        set({
          isModalOpen: true,
          currentAttachment: attachment,
          currentIndex,
          totalCount,
          sizeThreshold,
          resolver: resolve,
        })
      })
    },
    choose: (choice) => {
      const { resolver } = get()
      resolver?.(choice)
      set({ isModalOpen: false, currentAttachment: null, resolver: null })
    },
    cancel: () => {
      const { resolver } = get()
      resolver?.(undefined)
      set({ isModalOpen: false, currentAttachment: null, resolver: null })
    },
  })
)

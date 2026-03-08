import { create } from 'zustand'

export type ApprovalModalProps = {
  onApprove: (method: 'ctx_len' | 'context_shift') => void
  onDeny: () => void
}

type ApprovalState = {
  // Modal state
  isModalOpen: boolean
  modalProps: ApprovalModalProps | null

  showApprovalModal: () => Promise<'ctx_len' | 'context_shift' | undefined>
  closeModal: () => void
  setModalOpen: (open: boolean) => void
}

export const useContextSizeApproval = create<ApprovalState>()((set, get) => ({
  isModalOpen: false,
  modalProps: null,

  showApprovalModal: async () => {
    return new Promise<'ctx_len' | 'context_shift' | undefined>((resolve) => {
      set({
        isModalOpen: true,
        modalProps: {
          onApprove: (method) => {
            get().closeModal()
            resolve(method)
          },
          onDeny: () => {
            get().closeModal()
            resolve(undefined)
          },
        },
      })
    })
  },

  closeModal: () => {
    set({
      isModalOpen: false,
      modalProps: null,
    })
  },

  setModalOpen: (open: boolean) => {
    set({ isModalOpen: open })
    if (!open) {
      get().closeModal()
    }
  },
}))

import { atom } from 'jotai'

import { SwitchingModelConfirmationModalProps } from '@/components/SwitchingModelConfirmationModal'

export const showConfirmDeleteConversationModalAtom = atom(false)
export const showConfirmSignOutModalAtom = atom(false)
export const showConfirmDeleteModalAtom = atom(false)
export const showingAdvancedPromptAtom = atom<boolean>(false)
export const showingProductDetailAtom = atom<boolean>(false)
export const showingMobilePaneAtom = atom<boolean>(false)
export const showingBotListModalAtom = atom<boolean>(false)
export const showingCancelDownloadModalAtom = atom<boolean>(false)

export const switchingModelConfirmationModalPropsAtom = atom<
  SwitchingModelConfirmationModalProps | undefined
>(undefined)
export const showingModalNoActiveModel = atom<boolean>(false)

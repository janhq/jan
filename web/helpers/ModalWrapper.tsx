'use client'

import { ReactNode } from 'react'

import ConfirmDeleteConversationModal from '@/components/ConfirmDeleteConversationModal'

import ModalNoActiveModel from '@/components/ModalNoActiveModel'
import SwitchingModelConfirmationModal from '@/components/SwitchingModelConfirmationModal'

type Props = {
  children: ReactNode
}

export const ModalWrapper: React.FC<Props> = ({ children }) => (
  <>
    <ConfirmDeleteConversationModal />
    <SwitchingModelConfirmationModal />
    <ModalNoActiveModel />
    {children}
  </>
)

'use client'

import { ReactNode } from 'react'

import BotListModal from '@/components/BotListModal'
import ConfirmDeleteConversationModal from '@/components/ConfirmDeleteConversationModal'
import ConfirmDeleteModelModal from '@/components/ConfirmDeleteModelModal'
import MobileMenuPane from '@/components/MobileMenuPane'
import ModalNoActiveModel from '@/components/ModalNoActiveModel'
import SwitchingModelConfirmationModal from '@/components/SwitchingModelConfirmationModal'

type Props = {
  children: ReactNode
}

export const ModalWrapper: React.FC<Props> = ({ children }) => (
  <>
    <MobileMenuPane />
    <ConfirmDeleteConversationModal />
    <ConfirmDeleteModelModal />
    <BotListModal />
    <SwitchingModelConfirmationModal />
    <ModalNoActiveModel />
    {children}
  </>
)

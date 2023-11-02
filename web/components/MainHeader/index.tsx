import React from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { Trash2 } from 'lucide-react'

import { currentConversationAtom } from '@/helpers/atoms/Conversation.atom'
import { showConfirmDeleteConversationModalAtom } from '@/helpers/atoms/Modal.atom'

const MainHeader: React.FC = () => {
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  )
  const activeConversation = useAtomValue(currentConversationAtom)

  const currentConvo = useAtomValue(currentConversationAtom)
  const title = currentConvo?.name ?? ''

  if (!activeConversation) return null

  return (
    <div className="border-border sticky top-0 border-b bg-background/90 px-4 py-2">
      <span className="text-muted-foreground font-semibold">{title}</span>

      {/* right most */}
      <div className="absolute right-4 top-2">
        <Trash2
          role="button"
          size={16}
          onClick={() => setShowConfirmDeleteConversationModal(true)}
        />
      </div>
    </div>
  )
}

export default MainHeader

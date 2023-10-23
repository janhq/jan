import { currentConversationAtom } from '@helpers/atoms/Conversation.atom'
import {
  leftSideBarExpandStateAtom,
  rightSideBarExpandStateAtom,
} from '@helpers/atoms/SideBarExpand.atom'
import { showConfirmDeleteConversationModalAtom } from '@helpers/atoms/Modal.atom'
import { ChartPieIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useAtomValue, useSetAtom } from 'jotai'
import React from 'react'
import { Trash2 } from 'lucide-react'

const MainHeader: React.FC = () => {
  const setLeftSideBarVisibility = useSetAtom(leftSideBarExpandStateAtom)
  const setRightSideBarVisibility = useSetAtom(rightSideBarExpandStateAtom)
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  )
  const activeConversation = useAtomValue(currentConversationAtom)

  const currentConvo = useAtomValue(currentConversationAtom)
  let title = currentConvo?.name ?? ''

  if (!activeConversation) return null

  return (
    <div className="sticky top-0 border-b border-border bg-background/90 px-4 py-2">
      <span className="font-semibold text-muted-foreground">{title}</span>

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

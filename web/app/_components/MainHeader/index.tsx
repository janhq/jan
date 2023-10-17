import { currentConversationAtom } from '@/_helpers/atoms/Conversation.atom'
import {
  leftSideBarExpandStateAtom,
  rightSideBarExpandStateAtom,
} from '@/_helpers/atoms/LeftSideBarExpand.atom'
import { showConfirmDeleteConversationModalAtom } from '@/_helpers/atoms/Modal.atom'
import { ChartPieIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useAtomValue, useSetAtom } from 'jotai'
import React from 'react'

const MainHeader: React.FC = () => {
  const setLeftSideBarVisibility = useSetAtom(leftSideBarExpandStateAtom)
  const setRightSideBarVisibility = useSetAtom(rightSideBarExpandStateAtom)
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  )
  const activeConversation = useAtomValue(currentConversationAtom)

  const currentConvo = useAtomValue(currentConversationAtom)
  let title = currentConvo?.name ?? ''

  return (
    <div className="flex justify-between bg-gray-200 px-2 py-3">
      <ChartPieIcon
        color="#9CA3AF"
        width={22}
        height={22}
        role="button"
        onClick={() => setLeftSideBarVisibility((prev) => !prev)}
      />

      <span className="flex gap-0.5 text-base font-semibold leading-6">
        {title}
      </span>

      {/* right most */}
      <div className="flex gap-4">
        {activeConversation != null && (
          <TrashIcon
            role="button"
            width={24}
            height={24}
            color="#9CA3AF"
            onClick={() => setShowConfirmDeleteConversationModal(true)}
          />
        )}

        <ChartPieIcon
          role="button"
          width={24}
          height={24}
          color="#9CA3AF"
          onClick={() => setRightSideBarVisibility((prev) => !prev)}
        />
      </div>
    </div>
  )
}

export default MainHeader

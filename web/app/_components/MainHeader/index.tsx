import { currentConversationAtom } from '@/_helpers/atoms/Conversation.atom'
import {
  leftSideBarExpandStateAtom,
  rightSideBarExpandStateAtom,
  showRightSideBarToggleAtom,
} from '@/_helpers/atoms/LeftSideBarExpand.atom'
import { TrashIcon } from '@heroicons/react/24/outline'
import { showConfirmDeleteConversationModalAtom } from '@/_helpers/atoms/Modal.atom'
import { useAtomValue, useSetAtom } from 'jotai'
import React from 'react'
import Image from 'next/image'

const MainHeader: React.FC = () => {
  const setLeftSideBarVisibility = useSetAtom(leftSideBarExpandStateAtom)
  const setRightSideBarVisibility = useSetAtom(rightSideBarExpandStateAtom)
  const showRightSideBarToggle = useAtomValue(showRightSideBarToggleAtom)
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  )
  const activeConversation = useAtomValue(currentConversationAtom)

  const currentConvo = useAtomValue(currentConversationAtom)
  let title = currentConvo?.name ?? ''

  return (
    <div className="flex justify-between bg-gray-200 px-2 py-3">
      <Image
        role="button"
        alt=""
        src="icons/ic_sidebar_off.svg"
        width={24}
        onClick={() => setLeftSideBarVisibility((prev) => !prev)}
        height={24}
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

        {showRightSideBarToggle && (
          <Image
            role="button"
            alt=""
            src="icons/ic_sidebar_off.svg"
            width={24}
            onClick={() => setRightSideBarVisibility((prev) => !prev)}
            height={24}
          />
        )}
      </div>
    </div>
  )
}

export default MainHeader

'use client'

import { useSetAtom } from 'jotai'
import { TrashIcon } from '@heroicons/react/24/outline'
import { showConfirmDeleteConversationModalAtom } from '@/_helpers/atoms/Modal.atom'

const ModelMenu: React.FC = () => {
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  )

  return (
    <div className="flex items-center gap-3">
      <button onClick={() => setShowConfirmDeleteConversationModal(true)}>
        <TrashIcon width={24} height={24} color="#9CA3AF" />
      </button>
    </div>
  )
}

export default ModelMenu

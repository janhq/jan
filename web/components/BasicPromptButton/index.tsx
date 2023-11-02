import React from 'react'

import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { useSetAtom } from 'jotai'

import { showingAdvancedPromptAtom } from '@/helpers/atoms/Modal.atom'

const BasicPromptButton: React.FC = () => {
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom)

  return (
    <button
      onClick={() => setShowingAdvancedPrompt(false)}
      className="mx-2 mb-[10px] mt-3 flex flex-none items-center gap-1 text-xs leading-[18px] text-[#6B7280]"
    >
      <ChevronLeftIcon width={20} height={20} />
      <span className="text-xs font-semibold text-gray-500">BASIC PROMPT</span>
    </button>
  )
}

export default React.memo(BasicPromptButton)

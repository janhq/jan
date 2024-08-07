import React from 'react'

import { Button } from '@janhq/joi'

import { useAtomValue } from 'jotai'
import { StopCircle } from 'lucide-react'

import { disableStopInferenceAtom } from '@/helpers/atoms/ChatMessage.atom'

type Props = {
  onStopInferenceClick: () => void
}

const StopInferenceButton: React.FC<Props> = ({ onStopInferenceClick }) => {
  const disabled = useAtomValue(disableStopInferenceAtom)

  return (
    <Button
      disabled={disabled}
      theme="destructive"
      onClick={onStopInferenceClick}
      className="h-8 w-8 rounded-lg p-0"
    >
      <StopCircle size={20} />
    </Button>
  )
}

export default React.memo(StopInferenceButton)

import React from 'react'

import { Button } from '@janhq/joi'

import { StopCircle } from 'lucide-react'

import useSendMessage from '@/hooks/useSendMessage'

const StopInferenceButton: React.FC = () => {
  const { stopInference } = useSendMessage()

  return (
    <Button
      theme="destructive"
      onClick={stopInference}
      className="h-8 w-8 rounded-lg p-0"
    >
      <StopCircle size={20} />
    </Button>
  )
}

export default React.memo(StopInferenceButton)

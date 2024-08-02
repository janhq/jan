import React from 'react'

import { Button } from '@janhq/joi'

import { StopCircle } from 'lucide-react'

type Props = {
  onStopInferenceClick: () => void
}

const StopInferenceButton: React.FC<Props> = ({ onStopInferenceClick }) => (
  <Button
    theme="destructive"
    onClick={onStopInferenceClick}
    className="h-8 w-8 rounded-lg p-0"
  >
    <StopCircle size={20} />
  </Button>
)

export default React.memo(StopInferenceButton)

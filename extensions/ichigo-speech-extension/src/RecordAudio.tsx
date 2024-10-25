import React from 'react'
import { AudioLinesIcon } from 'lucide-react'
import { Button } from '@janhq/joi'

export const RecordAudio = () => {
  return (
    <>
      <Button theme="icon">
        <AudioLinesIcon
          size={18}
          className="text-[hsla(var(--text-secondary))]"
        />
      </Button>
    </>
  )
}

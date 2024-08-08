import React, { useCallback, useEffect, useState } from 'react'

import { TextArea } from '@janhq/joi'

import { useAtomValue } from 'jotai'
import { useDebouncedCallback } from 'use-debounce'

import useUpdateInstruction from '@/hooks/useUpdateInstruction'

import CopyOverInstruction from './components/CopyOverInstruction'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const AssistantSettingContainer: React.FC = () => {
  const experimentalEnabled = useAtomValue(experimentalFeatureEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const [instructions, setInstructions] = useState(
    activeThread?.assistants[0]?.instructions || ''
  )
  const { updateInstruction } = useUpdateInstruction()

  useEffect(() => {
    setInstructions(activeThread?.assistants[0]?.instructions || '')
  }, [activeThread])

  const debounced = useDebouncedCallback(async (instruction: string) => {
    updateInstruction(instruction)
  }, 500)

  const onInstructionChanged = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setInstructions(e.target.value)
      debounced(e.target.value)
    },
    [debounced]
  )

  return (
    <div className="flex flex-col space-y-4 p-4">
      <label
        id="assistant-instructions"
        className="mb-2 inline-block font-bold"
      >
        Instructions
      </label>
      <TextArea
        rows={5}
        id="assistant-instructions"
        placeholder="Eg. You are a helpful assistant."
        value={instructions}
        onChange={onInstructionChanged}
      />
      {experimentalEnabled && <CopyOverInstruction />}
    </div>
  )
}

export default AssistantSettingContainer

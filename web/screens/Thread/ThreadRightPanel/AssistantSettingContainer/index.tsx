import React, { useCallback, useEffect, useState } from 'react'

import { Button, TextArea } from '@janhq/joi'

import { useAtomValue, useSetAtom } from 'jotai'
import { Settings2Icon } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import ModelDropdown from '@/containers/ModelDropdown'

import useUpdateInstruction from '@/hooks/useUpdateInstruction'

import CopyOverInstruction from './components/CopyOverInstruction'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'

import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'
import { activeTabThreadRightPanelAtom } from '@/helpers/atoms/ThreadRightPanel.atom'

const AssistantSettingContainer: React.FC = () => {
  const experimentalEnabled = useAtomValue(experimentalFeatureEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const [instructions, setInstructions] = useState(
    activeThread?.assistants[0]?.instructions || ''
  )
  const setActiveTabThreadRightPanel = useSetAtom(activeTabThreadRightPanelAtom)
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
    <div className="flex flex-col p-4">
      <label
        id="assistant-instructions"
        className="mb-2 inline-block font-bold"
      >
        Instructions
      </label>
      <TextArea
        rows={5}
        id="assistant-instructions"
        placeholder="e.g., You are a helpful assistant."
        value={instructions}
        onChange={onInstructionChanged}
      />
      {experimentalEnabled && <CopyOverInstruction />}
      <div className="mt-2">
        <label
          id="assistant-instructions"
          className="mb-2 inline-block font-bold"
        >
          Model
        </label>
        <div className="flex gap-2">
          <div className="w-full">
            <ModelDropdown />
          </div>
          <Button
            theme="icon"
            variant="outline"
            className="!h-8 !w-8 flex-shrink-0"
            onClick={() => {
              setActiveTabThreadRightPanel('model')
            }}
          >
            <Settings2Icon
              size={16}
              className="flex-shrink-0 cursor-pointer text-[hsla(var(--text-secondary))]"
            />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default AssistantSettingContainer

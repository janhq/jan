import { useCallback, useEffect } from 'react'

import { Button } from '@janhq/joi'
import { AnimatePresence } from 'framer-motion'

import { useAtomValue } from 'jotai'
import { PenSquareIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import LeftPanelContainer from '@/containers/LeftPanelContainer'
import { toaster } from '@/containers/Toast'

import useAssistantQuery from '@/hooks/useAssistantQuery'

import useThreadCreateMutation from '@/hooks/useThreadCreateMutation'

import useThreads from '@/hooks/useThreads'

import { copyOverInstructionEnabledAtom } from '../ThreadRightPanel/AssistantSettingContainer/components/CopyOverInstruction'

import ThreadItem from './ThreadItem'

import { getSelectedModelAtom } from '@/helpers/atoms/Model.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'
import { activeThreadAtom, threadsAtom } from '@/helpers/atoms/Thread.atom'

const ThreadLeftPanel: React.FC = () => {
  const { setActiveThread } = useThreads()
  const createThreadMutation = useThreadCreateMutation()
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const selectedModel = useAtomValue(getSelectedModelAtom)
  const threads = useAtomValue(threadsAtom)

  const activeThread = useAtomValue(activeThreadAtom)
  const { data: assistants } = useAssistantQuery()
  const copyOverInstructionEnabled = useAtomValue(
    copyOverInstructionEnabledAtom
  )

  useEffect(() => {
    if (activeThread?.id) return
    if (threads.length === 0) return
    setActiveThread(threads[0].id)
  }, [activeThread?.id, setActiveThread, threads])

  const onCreateThreadClicked = useCallback(async () => {
    if (!assistants || assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: `Could not create a new thread. Please add an assistant.`,
        type: 'error',
      })
      return
    }
    if (!selectedModel) return
    let instructions: string | undefined = undefined
    if (copyOverInstructionEnabled) {
      instructions = activeThread?.assistants[0]?.instructions ?? undefined
    }
    await createThreadMutation.mutateAsync({
      modelId: selectedModel.model,
      assistant: assistants[0],
      instructions,
    })
  }, [
    createThreadMutation,
    selectedModel,
    assistants,
    activeThread,
    copyOverInstructionEnabled,
  ])

  return (
    <LeftPanelContainer>
      <div className={twMerge('pl-1.5 pt-3', reduceTransparent && 'pr-1.5')}>
        <Button
          className="mb-2"
          data-testid="btn-create-thread"
          onClick={onCreateThreadClicked}
          theme="icon"
        >
          <PenSquareIcon
            size={16}
            className="cursor-pointer text-[hsla(var(--text-secondary))]"
          />
        </Button>
        <AnimatePresence>
          {threads.map((thread) => (
            <ThreadItem key={thread.id} thread={thread} />
          ))}
        </AnimatePresence>
      </div>
    </LeftPanelContainer>
  )
}

export default ThreadLeftPanel

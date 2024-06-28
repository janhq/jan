import { useCallback, useEffect, useRef } from 'react'

import { Button } from '@janhq/joi'
import { AnimatePresence } from 'framer-motion'

import { useAtomValue } from 'jotai'
import { PenSquareIcon } from 'lucide-react'

import LeftPanelContainer from '@/containers/LeftPanelContainer'
import { toaster } from '@/containers/Toast'

import useThreads from '@/hooks/useThreads'

import ThreadItem from './ThreadItem'

import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'

import {
  downloadedModelsAtom,
  getSelectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import { getActiveThreadIdAtom, threadsAtom } from '@/helpers/atoms/Thread.atom'

const ThreadLeftPanel: React.FC = () => {
  const { createThread, setActiveThread } = useThreads()

  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const selectedModel = useAtomValue(getSelectedModelAtom)
  const threads = useAtomValue(threadsAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const assistants = useAtomValue(assistantsAtom)

  const isCreatingThread = useRef(false)

  useEffect(() => {
    // if user does not have any threads, we should create one
    const createThreadIfEmpty = async () => {
      if (assistants.length === 0) return
      if (downloadedModels.length === 0) return
      if (threads.length > 0) return
      if (isCreatingThread.current) return
      isCreatingThread.current = true
      // user have models but does not have any thread. Let's create one
      await createThread(downloadedModels[0].id, assistants[0])
      isCreatingThread.current = false
    }
    createThreadIfEmpty()
  }, [threads, assistants, downloadedModels, createThread])

  useEffect(() => {
    const setActiveThreadIfNone = () => {
      if (activeThreadId) return
      if (threads.length === 0) return
      setActiveThread(threads[0].id)
    }
    setActiveThreadIfNone()
  }, [activeThreadId, setActiveThread, threads])

  const onCreateThreadClicked = useCallback(async () => {
    if (assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: `Could not create a new thread. Please add an assistant.`,
        type: 'error',
      })
      return
    }
    if (!selectedModel) return
    createThread(selectedModel.id, assistants[0])
  }, [createThread, selectedModel, assistants])

  return (
    <LeftPanelContainer>
      <div className="pl-1.5 pt-3">
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

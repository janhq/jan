import { useCallback, useEffect } from 'react'

import { Thread } from '@janhq/core/'

import { motion as m } from 'framer-motion'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  GalleryHorizontalEndIcon,
  MoreHorizontalIcon,
  PenSquareIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { toaster } from '@/containers/Toast'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useRecommendedModel from '@/hooks/useRecommendedModel'
import useSetActiveThread from '@/hooks/useSetActiveThread'

import CleanThreadModal from '../CleanThreadModal'

import DeleteThreadModal from '../DeleteThreadModal'

import { showLeftPanelAtom } from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  getActiveThreadIdAtom,
  threadDataReadyAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function ThreadList() {
  const showLeftSideBar = useAtomValue(showLeftPanelAtom)
  const threads = useAtomValue(threadsAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const { setActiveThread } = useSetActiveThread()
  const assistants = useAtomValue(assistantsAtom)
  const threadDataReady = useAtomValue(threadDataReadyAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const setEditMessage = useSetAtom(editMessageAtom)
  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const onThreadClick = useCallback(
    (thread: Thread) => {
      setActiveThread(thread)
      setEditMessage('')
    },
    [setActiveThread, setEditMessage]
  )

  /**
   * Auto create thread
   * This will create a new thread if there are assistants available
   * and there are no threads available
   */
  useEffect(() => {
    if (
      threadDataReady &&
      assistants.length > 0 &&
      threads.length === 0 &&
      (recommendedModel || downloadedModels[0])
    ) {
      const model = recommendedModel || downloadedModels[0]
      requestCreateNewThread(assistants[0], model)
    } else if (threadDataReady && !activeThreadId) {
      setActiveThread(threads[0])
    }
  }, [
    assistants,
    threads,
    threadDataReady,
    requestCreateNewThread,
    activeThreadId,
    setActiveThread,
    recommendedModel,
    downloadedModels,
  ])

  const onCreateConversationClick = async () => {
    if (assistants.length === 0) {
      toaster({
        title: 'No assistant available.',
        description: `Could not create a new thread. Please add an assistant.`,
        type: 'error',
      })
    } else {
      requestCreateNewThread(assistants[0])
    }
  }

  if (!showLeftSideBar) return

  return (
    <div className="flex h-full w-40 flex-shrink-0 flex-col border-r border-[hsla(var(--app-border))] px-2 py-3">
      {threads.length === 0 ? (
        <div className="p-2 text-center">
          <GalleryHorizontalEndIcon
            size={16}
            className="text-[hsla(var(--text-secondary)] mx-auto mb-3"
          />
          <h2 className="font-semibold">No Thread History</h2>
        </div>
      ) : (
        <>
          <div
            className="mb-2 cursor-pointer"
            data-testid="btn-create-thread"
            onClick={onCreateConversationClick}
          >
            <PenSquareIcon
              size={16}
              className="text-[hsla(var(--text-secondary))]"
            />
          </div>
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={twMerge(
                `group/message relative mb-1 flex cursor-pointer flex-col transition-all hover:rounded-lg hover:bg-[hsla(var(--app-secondary-bg))]`
              )}
              onClick={() => {
                onThreadClick(thread)
              }}
            >
              <div className="relative z-10 p-2">
                <h1
                  className={twMerge(
                    'line-clamp-1 group-hover/message:pr-6',
                    activeThreadId && 'font-medium'
                  )}
                >
                  {thread.title}
                </h1>
              </div>
              <div
                className={twMerge(
                  `group/icon text-[hsla(var(--text-secondary)] invisible absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-md px-0.5 hover:bg-[hsla(var(--app-secondary-bg))] group-hover/message:visible`
                )}
              >
                <MoreHorizontalIcon className="text-[hsla(var(--app-text-primary))]" />
                <div className="invisible absolute left-0 z-50 w-40 overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-lg group-hover/icon:visible">
                  <CleanThreadModal threadId={thread.id} />
                  <DeleteThreadModal threadId={thread.id} />
                </div>
              </div>
              {activeThreadId === thread.id && (
                <m.div
                  className="absolute inset-0 left-0 h-full w-full rounded-lg bg-[hsla(var(--left-panel-icon-active-bg))]"
                  layoutId="active-thread"
                />
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

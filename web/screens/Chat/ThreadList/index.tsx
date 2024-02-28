import { useCallback, useEffect } from 'react'

import { Thread } from '@janhq/core/'

import { motion as m } from 'framer-motion'
import { useAtomValue, useSetAtom } from 'jotai'
import { GalleryHorizontalEndIcon, MoreVerticalIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useSetActiveThread from '@/hooks/useSetActiveThread'

import { displayDate } from '@/utils/datetime'

import CleanThreadModal from '../CleanThreadModal'

import DeleteThreadModal from '../DeleteThreadModal'

import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'
import {
  getActiveThreadIdAtom,
  threadDataReadyAtom,
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Thread.atom'

export default function ThreadList() {
  const threadStates = useAtomValue(threadStatesAtom)
  const threads = useAtomValue(threadsAtom)
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const { setActiveThread } = useSetActiveThread()
  const assistants = useAtomValue(assistantsAtom)
  const threadDataReady = useAtomValue(threadDataReadyAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const setEditMessage = useSetAtom(editMessageAtom)

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
    if (threadDataReady && assistants.length > 0 && threads.length === 0) {
      requestCreateNewThread(assistants[0])
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
  ])

  return (
    <div className="px-3 py-4">
      {threads.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <GalleryHorizontalEndIcon
            size={26}
            className="mx-auto mb-3 text-muted-foreground"
          />
          <h2 className="font-semibold">No Thread History</h2>
        </div>
      ) : (
        threads.map((thread) => (
          <div
            key={thread.id}
            className={twMerge(
              `group/message relative mb-1 flex cursor-pointer flex-col transition-all hover:rounded-lg hover:bg-gray-100`
            )}
            onClick={() => {
              onThreadClick(thread)
            }}
          >
            <div className="relative z-10 p-4 py-4">
              <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">
                {thread.updated && displayDate(thread.updated)}
              </p>
              <h2 className="line-clamp-1 font-bold">{thread.title}</h2>
              <p className="mt-1 line-clamp-1 text-xs text-gray-700 group-hover/message:max-w-[160px]">
                {threadStates[thread.id]?.lastMessage
                  ? threadStates[thread.id]?.lastMessage
                  : 'No new message'}
              </p>
            </div>
            <div
              className={twMerge(
                `group/icon invisible absolute bottom-2 right-2 z-20 rounded-lg p-1 text-muted-foreground hover:bg-gray-200 group-hover/message:visible`
              )}
            >
              <MoreVerticalIcon />
              <div className="invisible absolute right-0 z-20 w-40 overflow-hidden rounded-lg border border-border bg-background shadow-lg group-hover/icon:visible">
                <CleanThreadModal threadId={thread.id} />
                <DeleteThreadModal threadId={thread.id} />
              </div>
            </div>
            {activeThreadId === thread.id && (
              <m.div
                className="absolute inset-0 left-0 h-full w-full rounded-lg bg-gray-100 p-4"
                layoutId="active-thread"
              />
            )}
          </div>
        ))
      )}
    </div>
  )
}

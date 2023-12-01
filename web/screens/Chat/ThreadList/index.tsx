import { useEffect } from 'react'

import { useAtomValue } from 'jotai'
import { GalleryHorizontalEndIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import useGetAllThreads from '@/hooks/useGetAllThreads'

import useSetActiveThread from '@/hooks/useSetActiveThread'

import { displayDate } from '@/utils/datetime'

import {
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Conversation.atom'

export default function ThreadList() {
  const threads = useAtomValue(threadsAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const { getAllThreads } = useGetAllThreads()

  const { activeThreadId, setActiveThread: onThreadClick } =
    useSetActiveThread()

  useEffect(() => {
    getAllThreads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        threads.map((thread, i) => {
          const lastMessage =
            threadStates[thread.id]?.lastMessage ?? 'No new message'
          return (
            <div
              key={i}
              className={twMerge(
                'relative mb-2 flex cursor-pointer flex-col rounded-lg bg-gray-100 p-4 dark:bg-secondary/50'
                // activeThreadId === thread.id && 'bg-secondary-10'
              )}
              onClick={() => onThreadClick(thread)}
            >
              <div className="flex justify-between">
                <h2 className="line-clamp-1 font-bold">{thread.title}</h2>
                <p className="mb-1 line-clamp-1 text-xs leading-5">
                  {thread.updated &&
                    displayDate(new Date(thread.updated).getTime())}
                </p>
              </div>
              <p className="mt-1 line-clamp-2 text-xs">{lastMessage}</p>
            </div>
          )
        })
      )}
    </div>
  )
}

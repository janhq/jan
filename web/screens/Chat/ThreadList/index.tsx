import { useEffect } from 'react'

import { motion as m } from 'framer-motion'
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
            className="mx-auto text-muted-foreground"
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
              className={twMerge('relative flex cursor-pointer flex-col px-4')}
              onClick={() => onThreadClick(thread)}
            >
              <div className="relative z-10 py-4">
                <div className="flex justify-between">
                  <h2 className="line-clamp-1 font-bold">{thread.title}</h2>
                  <p className="mb-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                    {thread.updated &&
                      displayDate(new Date(thread.updated).getTime())}
                  </p>
                </div>
                <p className="line-clamp-2 text-xs text-gray-700 dark:text-gray-300">
                  {lastMessage || 'No new message'}
                </p>
              </div>
              {activeThreadId === thread.id && (
                <m.div
                  className="absolute inset-0 left-0 h-full w-full rounded-lg bg-gray-100 p-4 dark:bg-secondary/50"
                  layoutId="active-thread"
                />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

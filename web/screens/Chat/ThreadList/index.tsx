import { Button } from '@janhq/uikit'
import { motion as m } from 'framer-motion'
import { useAtomValue } from 'jotai'
import { GalleryHorizontalEndIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import { displayDate } from '@/utils/datetime'
import {
  threadStatesAtom,
  threadsAtom,
} from '@/helpers/atoms/Conversation.atom'
import useGetAssistants from '@/hooks/useGetAssistants'
import useSetActiveThread from '@/hooks/useSetActiveThread'
import useGetAllThreads from '@/hooks/useGetAllThreads'
import { useEffect } from 'react'

export default function ThreadList() {
  const threads = useAtomValue(threadsAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const { assistants } = useGetAssistants()
  const { getAllThreads } = useGetAllThreads()

  const { activeThreadId, setActiveThread: onThreadClick } =
    useSetActiveThread()

  useEffect(() => {
    getAllThreads()
  }, [])

  const onCreateConversationClick = async () => {
    if (assistants.length === 0) {
      alert('No assistant available')
      return
    }

    requestCreateNewThread(assistants[0])
  }

  return (
    <div>
      <div className="sticky top-0 z-20 flex flex-col border-b border-border bg-background px-4 py-3">
        <Button
          size="sm"
          themes="secondary"
          onClick={onCreateConversationClick}
        >
          Create New Chat
        </Button>
      </div>

      {threads.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <GalleryHorizontalEndIcon
            size={26}
            className="mx-auto mb-3 text-muted-foreground"
          />
          <h2 className="font-semibold">No Chat History</h2>
          <p className="mt-1 text-xs">Get started by creating a new chat</p>
        </div>
      ) : (
        threads.map((thread, i) => {
          const lastMessage = threadStates[thread.id]?.lastMessage ?? ''
          return (
            <div
              key={i}
              className={twMerge(
                'relative flex cursor-pointer flex-col border-b border-border px-4 py-2 hover:bg-secondary/20',
                activeThreadId === thread.id && 'bg-secondary-10'
              )}
              onClick={() => onThreadClick(thread)}
            >
              <p className="mb-1 line-clamp-1 text-xs leading-5">
                {thread.updated &&
                  displayDate(new Date(thread.updated).getTime())}
              </p>
              <h2 className="line-clamp-1">{thread.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs">{lastMessage}</p>
              {activeThreadId === thread.id && (
                <m.div
                  className="absolute right-0 top-0 h-full w-1 bg-primary/50"
                  layoutId="active-convo"
                />
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

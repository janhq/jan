import { useEffect, useMemo } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'

import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useShallow } from 'zustand/react/shallow'
import { ThreadContent } from '@/containers/ThreadContent'
import { StreamingContent } from '@/containers/StreamingContent'

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const { threadId } = useParams({ from: Route.id })
  const { currentThreadId, getThreadById, setCurrentThreadId } = useThreads()
  const threadContent = useThreads(
    useShallow((state) => state.threads[threadId]?.content || [])
  )
  const thread = useMemo(
    () => getThreadById(threadId),
    [threadId, getThreadById]
  )

  useEffect(() => {
    if (currentThreadId !== threadId) setCurrentThreadId(threadId)
  }, [threadId, currentThreadId, setCurrentThreadId])

  const threadModel = useMemo(() => thread?.model, [thread])

  if (!threadContent || !threadModel) return null

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <DropdownModelProvider model={threadModel} />
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-40px)] ">
        <div className="flex flex-col h-full w-full p-4 overflow-auto">
          <div className="max-w-none w-4/6 mx-auto">
            {threadContent &&
              threadContent.map((item, index) => {
                return <ThreadContent {...item} key={index} />
              })}
            <StreamingContent />
          </div>
        </div>
        <div className="w-4/6 mx-auto py-2 shrink-0">
          <ChatInput />
        </div>
      </div>
    </div>
  )
}

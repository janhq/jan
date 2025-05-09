import { useCallback, useMemo } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'

import { useThreads } from '@/hooks/useThreads'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import ChatInput from '@/containers/ChatInput'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import { newUserThreadContent } from '@/helpers/threads'
import { useModelProvider } from '@/hooks/useModelProvider'

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const { threadId } = useParams({ from: Route.id })
  const { prompt } = usePrompt()
  const { getProviderByName, selectedProvider } = useModelProvider()
  const { getThreadById, addThreadContent, sendCompletion } = useThreads()

  const provider = useMemo(() => {
    return getProviderByName(selectedProvider)
  }, [selectedProvider, getProviderByName])

  const sendMessage = useCallback(() => {
    addThreadContent(threadId, newUserThreadContent(prompt))
    sendCompletion(provider, threadId, prompt)
  }, [prompt, threadId, provider, addThreadContent, sendCompletion])

  const thread = useMemo(
    () => getThreadById(threadId),
    [threadId, getThreadById]
  )

  if (!thread) return null

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <DropdownModelProvider threadData={thread} />
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-40px)] ">
        <div className="flex flex-col h-full w-full p-4 overflow-auto">
          <div className="max-w-none w-4/6 mx-auto">
            {thread.content &&
              thread.content.map((item, index) => {
                return (
                  <div key={index} className="mb-4">
                    {item.type === 'text' &&
                      item.text &&
                      item.role === 'user' && (
                        <div className="flex justify-end w-full">
                          <div className="bg-accent text-accent-fg p-2 rounded-md inline-block">
                            <p>{item.text.value}</p>
                          </div>
                        </div>
                      )}
                    {item.type === 'text' &&
                      item.text &&
                      item.role !== 'user' && (
                        <RenderMarkdown
                          content={item.text.value}
                          components={{
                            a: ({ ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                          }}
                        />
                      )}
                    {item.type === 'image_url' && item.image_url && (
                      <div>
                        <img
                          src={item.image_url.url}
                          alt={item.image_url.detail || 'Thread image'}
                          className="max-w-full rounded-md"
                        />
                        {item.image_url.detail && (
                          <p className="text-sm mt-1">
                            {item.image_url.detail}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
        <div className="w-4/6 mx-auto py-2 shrink-0">
          <ChatInput handleSubmit={sendMessage} />
        </div>
      </div>
    </div>
  )
}

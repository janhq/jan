import { useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import cloneDeep from 'lodash.clonedeep'
import { cn } from '@/lib/utils'

import HeaderPage from '@/containers/HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { ThreadContent } from '@/containers/ThreadContent'
import { StreamingContent } from '@/containers/StreamingContent'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import DropdownAssistant from '@/containers/DropdownAssistant'
import { useAssistant } from '@/hooks/useAssistant'
import { useAppearance } from '@/hooks/useAppearance'
import { ContentType, ThreadMessage } from '@janhq/core'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import ScrollToBottom from '@/containers/ScrollToBottom'
import { PromptProgress } from '@/components/PromptProgress'

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)

  const chatWidth = useAppearance((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()

  const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCurrentThreadId(threadId)
    const assistant = assistants.find(
      (assistant) => assistant.id === thread?.assistants?.[0]?.id
    )
    if (assistant) setCurrentAssistant(assistant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, assistants])

  useEffect(() => {
    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages) {
          // For web platform: preserve local messages if server fetch is empty but we have local messages
          if (PlatformFeatures[PlatformFeature.FIRST_MESSAGE_PERSISTED_THREAD] &&
              fetchedMessages.length === 0 &&
              messages &&
              messages.length > 0) {
            console.log('!!!Preserving local messages as server fetch is empty:', messages.length)
            // Don't override local messages with empty server response
            return
          }

          // Update the messages in the store
          setMessages(threadId, fetchedMessages)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serviceHub])

  useEffect(() => {
    return () => {
      // Clear the current thread ID when the component unmounts
      setCurrentThreadId(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateMessage = (
    item: ThreadMessage,
    message: string,
    imageUrls?: string[]
  ) => {
    const newMessages: ThreadMessage[] = messages.map((m) => {
      if (m.id === item.id) {
        const msg: ThreadMessage = cloneDeep(m)
        const newContent = [
          {
            type: ContentType.Text,
            text: {
              value: message,
              annotations: m.content[0].text?.annotations ?? [],
            },
          },
        ]
        // Add image content if imageUrls are provided
        if (imageUrls && imageUrls.length > 0) {
          imageUrls.forEach((url) => {
            newContent.push({
              type: 'image_url' as ContentType,
              image_url: {
                url: url,
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
          })
        }
        msg.content = newContent
        return msg
      }
      return m
    })
    setMessages(threadId, newMessages)
  }

  const threadModel = useMemo(() => thread?.model, [thread])

  if (!messages || !threadModel) return null

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
            <DropdownAssistant />
          )}
        </div>
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-40px)]">
        <div
          ref={scrollContainerRef}
          className={cn(
            'flex flex-col h-full w-full overflow-auto px-4 pt-4 pb-3'
          )}
        >
          <div
            className={cn(
              'w-4/6 mx-auto flex max-w-full flex-col grow',
              chatWidth === 'compact' ? 'w-full md:w-4/6' : 'w-full',
              isSmallScreen && 'w-full'
            )}
          >
            {messages &&
              messages.map((item, index) => {
                // Only pass isLastMessage to the last message in the array
                const isLastMessage = index === messages.length - 1
                return (
                  <div
                    key={item.id}
                    data-test-id={`message-${item.role}-${item.id}`}
                    data-message-author-role={item.role}
                    className="mb-4"
                  >
                    <ThreadContent
                      {...item}
                      isLastMessage={isLastMessage}
                      showAssistant={
                        item.role === 'assistant' &&
                        (index === 0 ||
                          messages[index - 1]?.role !== 'assistant' ||
                          !(
                            messages[index - 1]?.metadata &&
                            'tool_calls' in (messages[index - 1].metadata ?? {})
                          ))
                      }
                      index={index}
                      updateMessage={updateMessage}
                    />
                  </div>
                )
              })}
            <PromptProgress />
            <StreamingContent
              threadId={threadId}
              data-test-id="thread-content-text"
            />
          </div>
        </div>
        <div
          className={cn(
            'mx-auto pt-2 pb-3 shrink-0 relative px-2',
            chatWidth === 'compact' ? 'w-full md:w-4/6' : 'w-full',
            isSmallScreen && 'w-full'
          )}
        >
          <ScrollToBottom
            threadId={threadId}
            scrollContainerRef={scrollContainerRef}
          />
          <ChatInput model={threadModel} />
        </div>
      </div>
    </div>
  )
}

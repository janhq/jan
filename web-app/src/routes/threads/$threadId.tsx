import { useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useParams, redirect, useNavigate } from '@tanstack/react-router'
import cloneDeep from 'lodash.clonedeep'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

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
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { ContentType, ThreadMessage } from '@janhq/core'
import { useSmallScreen, useMobileScreen } from '@/hooks/useMediaQuery'
import { useTools } from '@/hooks/useTools'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import ScrollToBottom from '@/containers/ScrollToBottom'
import { PromptProgress } from '@/components/PromptProgress'
import { ThreadPadding } from '@/containers/ThreadPadding'
import { TEMPORARY_CHAT_ID, TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
import { IconInfoCircle } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const CONVERSATION_NOT_FOUND_EVENT = 'conversation-not-found'

const TemporaryChatIndicator = ({ t }: { t: (key: string) => string }) => {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-main-view-fg/5 text-main-view-fg/70 text-sm">
      <span>{t('common:temporaryChat')}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative z-20">
            <IconInfoCircle
              size={14}
              className="text-main-view-fg/50 hover:text-main-view-fg/70 transition-colors cursor-pointer"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="z-[9999]">
          <p>{t('common:temporaryChatTooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  beforeLoad: ({ params }) => {
    // Check if this is the temporary chat being accessed directly
    if (params.threadId === TEMPORARY_CHAT_ID) {
      // Check if we have the navigation flag in sessionStorage
      const hasNavigationFlag = sessionStorage.getItem('temp-chat-nav')

      if (!hasNavigationFlag) {
        // Direct access - redirect to home with query parameter
        throw redirect({
          to: '/',
          search: { [TEMPORARY_CHAT_QUERY_ID]: true },
          replace: true,
        })
      }

      // Clear the flag immediately after checking
      sessionStorage.removeItem('temp-chat-nav')
    }
  },
  component: ThreadDetail,
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const navigate = useNavigate()
  const { t } = useTranslation()
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()
  const isMobile = useMobileScreen()
  useTools()

  const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const scrollContainerRef = useRef<HTMLDivElement>(null)


  // Listen for conversation not found events
  useEffect(() => {
    const handleConversationNotFound = (event: CustomEvent) => {
      const { threadId: notFoundThreadId } = event.detail
      if (notFoundThreadId === threadId) {
        // Skip error handling for temporary chat - it's expected to not exist on server
        if (threadId === TEMPORARY_CHAT_ID) {
          return
        }

        toast.error(t('common:conversationNotAvailable'), {
          description: t('common:conversationNotAvailableDescription')
        })
        navigate({ to: '/', replace: true })
      }
    }

    window.addEventListener(CONVERSATION_NOT_FOUND_EVENT, handleConversationNotFound as EventListener)
    return () => {
      window.removeEventListener(CONVERSATION_NOT_FOUND_EVENT, handleConversationNotFound as EventListener)
    }
  }, [threadId, navigate, t])

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
          const currentLocalMessages = useMessages.getState().getMessages(threadId)

          if (PlatformFeatures[PlatformFeature.FIRST_MESSAGE_PERSISTED_THREAD] &&
              fetchedMessages.length === 0 &&
              currentLocalMessages &&
              currentLocalMessages.length > 0
          ) {
            return
          }

          // Update the messages in the store
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
              const mergedMessages = [...fetchedMessages, ...localOnlyMessages].sort(
                (a, b) => (a.created_at || 0) - (b.created_at || 0)
              )
              setMessages(threadId, mergedMessages)
              return
            }
          }

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
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <div>
            {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
              <DropdownAssistant />
            )}
          </div>
          <div className="flex-1 flex justify-center">
            {threadId === TEMPORARY_CHAT_ID && <TemporaryChatIndicator t={t} />}
          </div>
          <div></div>
        </div>
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-40px)]">
        <div
          ref={scrollContainerRef}
          className={cn(
            'flex flex-col h-full w-full overflow-auto pt-4 pb-3',
            // Mobile-first responsive padding
            isMobile ? 'px-3' : 'px-4'
          )}
        >
          <div
            className={cn(
              'mx-auto flex max-w-full flex-col grow',
              // Mobile-first width constraints
              // Mobile and small screens always use full width, otherwise compact chat uses constrained width
              isMobile || isSmallScreen || chatWidth !== 'compact'
                ? 'w-full'
                : 'w-full md:w-4/6'
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
            {/* Persistent padding element for ChatGPT-style message positioning */}
           <ThreadPadding threadId={threadId} scrollContainerRef={scrollContainerRef} />
          </div>
        </div>
        <div
          className={cn(
            'mx-auto pt-2 pb-3 shrink-0 relative',
            // Responsive padding and width
            isMobile ? 'px-3' : 'px-2',
            // Width: mobile/small screens or non-compact always full, compact desktop uses constrained
            isMobile || isSmallScreen || chatWidth !== 'compact'
              ? 'w-full'
              : 'w-full md:w-4/6'
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

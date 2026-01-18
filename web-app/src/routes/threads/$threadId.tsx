import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createFileRoute,
  useParams,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

import HeaderPage from '@/containers/HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import DropdownAssistant from '@/containers/DropdownAssistant'
import { useAssistant } from '@/hooks/useAssistant'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useSmallScreen, useMobileScreen } from '@/hooks/useMediaQuery'
import { useTools } from '@/hooks/useTools'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { TEMPORARY_CHAT_ID, TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
import { IconInfoCircle } from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useChat } from '@/hooks/use-chat'
import { createLanguageModel } from '@/lib/ai-model'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/ai-elements/conversation'
import { Loader } from 'lucide-react'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage, UIDataTypes, UITools } from 'ai'
import { useChatSessions } from '@/stores/chat-session-store'
import { convertThreadMessagesToUIMessages } from '@/lib/messages'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

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
  const currentAssistant = useAssistant((state) => state.currentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()
  const isMobile = useMobileScreen()
  useTools()

  // Session data for tool call tracking
  const getSessionData = useChatSessions((state) => state.getSessionData)
  const sessionData = getSessionData(threadId)

  // AbortController for cancelling tool calls
  const toolCallAbortController = useRef<AbortController | null>(null)

  // Check if we should follow up with tool calls (respects abort signal)
  const followUpMessage = useCallback(
    ({
      messages,
    }: {
      messages: UIMessage<unknown, UIDataTypes, UITools>[]
    }) => {
      if (
        !toolCallAbortController.current ||
        toolCallAbortController.current?.signal.aborted
      ) {
        return false
      }
      return lastAssistantMessageIsCompleteWithToolCalls({ messages })
    },
    []
  )

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))

  // Get model and provider for useChat
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  // Create language model for AI SDK (async)
  const [languageModel, setLanguageModel] = useState<Awaited<
    ReturnType<typeof createLanguageModel>
  > | null>(null)

  useEffect(() => {
    const provider = getProviderByName(selectedProvider)
    const modelId = selectedModel?.id ?? thread?.model?.id ?? ''
    if (!modelId || !provider) {
      setLanguageModel(null)
      return
    }

    let cancelled = false
    createLanguageModel(modelId, provider, provider)
      .then((model) => {
        if (!cancelled) {
          setLanguageModel(model)
        }
      })
      .catch((error) => {
        console.error('Failed to create language model:', error)
        if (!cancelled) {
          setLanguageModel(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    selectedModel?.id,
    thread?.model?.id,
    selectedProvider,
    getProviderByName,
  ])

  // Handle onFinish - execute collected tool calls
  const handleOnFinish = useCallback(() => {
    // Create a new AbortController for tool calls
    toolCallAbortController.current = new AbortController()
    const signal = toolCallAbortController.current.signal

    // Execute all collected tool calls
    Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionData.tools.map(async (toolCall: any) => {
        // Check if already aborted before starting
        if (signal.aborted) {
          return
        }

        try {
          const result = await serviceHub.mcp().callTool({
            toolName: toolCall.toolName,
            arguments: toolCall.input,
          })

          if (result.error) {
            addToolOutput({
              state: 'output-error',
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              errorText: `Error: ${result.error}`,
            })
          } else {
            addToolOutput({
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              output: result.content,
            })
          }
        } catch (error) {
          // Ignore abort errors
          if ((error as Error).name !== 'AbortError') {
            console.error('Tool call error:', error)
            addToolOutput({
              state: 'output-error',
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              errorText: `Error: ${(error as Error).message}`,
            })
          }
        }
      })
    )
      .catch((error) => {
        // Ignore abort errors
        if (error.name !== 'AbortError') {
          console.error('Tool call error:', error)
        }
      })
      .finally(() => {
        sessionData.tools = []
        toolCallAbortController.current = null
      })
  }, [sessionData, serviceHub])

  // Handle onToolCall - collect tool calls during streaming
  const handleOnToolCall = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ toolCall }: { toolCall: any }) => {
      sessionData.tools.push(toolCall)
      return
    },
    [sessionData]
  )

  // Use the AI SDK chat hook
  const {
    messages: chatMessages,
    status,
    sendMessage,
    regenerate,
    setMessages: setChatMessages,
    stop,
    addToolOutput,
  } = useChat(languageModel, {
    sessionId: threadId,
    sessionTitle: thread?.title,
    experimental_throttle: 50,
    onFinish: handleOnFinish,
    onToolCall: handleOnToolCall,
    sendAutomaticallyWhen: followUpMessage,
  })

  // Use chatMessages directly from useChat
  const messages = chatMessages ?? []

  // Ref for reasoning container auto-scroll
  const reasoningContainerRef = useRef<HTMLDivElement>(null)

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
          description: t('common:conversationNotAvailableDescription'),
        })
        navigate({ to: '/', replace: true })
      }
    }

    window.addEventListener(
      CONVERSATION_NOT_FOUND_EVENT,
      handleConversationNotFound as EventListener
    )
    return () => {
      window.removeEventListener(
        CONVERSATION_NOT_FOUND_EVENT,
        handleConversationNotFound as EventListener
      )
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

  // Load messages on first mount
  useEffect(() => {
    // Skip if chat already has messages (e.g., returning to a streaming conversation)
    const existingSession = useChatSessions.getState().sessions[threadId]
    if (
      existingSession?.chat.messages.length > 0 ||
      existingSession?.isStreaming
    ) {
      return
    }

    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages) {
          const currentLocalMessages = useMessages
            .getState()
            .getMessages(threadId)

          if (
            PlatformFeatures[PlatformFeature.FIRST_MESSAGE_PERSISTED_THREAD] &&
            fetchedMessages.length === 0 &&
            currentLocalMessages &&
            currentLocalMessages.length > 0
          ) {
            return
          }

          let messagesToSet = fetchedMessages

          // Merge with local-only messages if needed
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
              messagesToSet = [...fetchedMessages, ...localOnlyMessages].sort(
                (a, b) => (a.created_at || 0) - (b.created_at || 0)
              )
            }
          }

          // Update the legacy store
          setMessages(threadId, messagesToSet)

          // Convert and set messages for AI SDK chat
          const uiMessages = convertThreadMessagesToUIMessages(messagesToSet)
          setChatMessages(uiMessages)
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

  // Handle submit from ChatInput
  const handleSubmit = useCallback(
    (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      if (!languageModel) return

      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; url: string }
      > = [{ type: 'text', text }]

      if (files) {
        files.forEach((file) => {
          parts.push({
            type: 'file',
            mediaType: file.mediaType,
            url: file.url,
          })
        })
      }

      sendMessage({ parts })
    },
    [languageModel, sendMessage]
  )

  // Handle regenerate from ThreadContent
  const handleRegenerate = useCallback(
    (messageId?: string) => {
      if (!languageModel) return
      regenerate(messageId ? { messageId } : undefined)
    },
    [languageModel, regenerate]
  )

  // Handle stop
  const handleStop = useCallback(() => {
    stop()
  }, [stop])

  const threadModel = useMemo(() => thread?.model, [thread])

  if (!threadModel) return null

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
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 relative">
          <Conversation className="absolute inset-0 text-start">
            <ConversationContent
              className={cn(
                'mx-auto',
                isMobile || isSmallScreen || chatWidth !== 'compact'
                  ? 'w-full'
                  : 'w-full md:w-4/5'
              )}
            >
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1
                const isFirstMessage = index === 0
                const showAssistant =
                  message.role === 'assistant' &&
                  (isFirstMessage || messages[index - 1]?.role !== 'assistant')

                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isFirstMessage={isFirstMessage}
                    isLastMessage={isLastMessage}
                    status={status}
                    reasoningContainerRef={reasoningContainerRef}
                    onRegenerate={handleRegenerate}
                    showAssistant={showAssistant}
                    assistant={
                      currentAssistant
                        ? {
                            avatar: currentAssistant.avatar,
                            name: currentAssistant.name,
                          }
                        : undefined
                    }
                  />
                )
              })}
              {status === CHAT_STATUS.SUBMITTED && (
                <Loader className="animate-spin w-4 h-4" />
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        {/* Chat Input - Fixed at bottom */}
        <div
          className={cn(
            'px-4 py-4 mx-auto w-full',
            isMobile || isSmallScreen || chatWidth !== 'compact'
              ? 'max-w-full'
              : 'w-full md:w-4/5'
          )}
        >
          <ChatInput
            model={threadModel}
            onSubmit={handleSubmit}
            onStop={handleStop}
            chatStatus={status}
          />
        </div>
      </div>
    </div>
  )
}

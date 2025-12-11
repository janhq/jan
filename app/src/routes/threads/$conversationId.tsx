import { createFileRoute, useParams } from '@tanstack/react-router'

import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import { useChat } from '@/hooks/use-chat'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAuthenticatedFetch } from '@/lib/api-client'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import {
  RefreshCcwIcon,
  CopyIcon,
  Loader,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react'
import { useModels } from '@/stores/models-store'
import { useEffect, useRef } from 'react'
import { useConversations } from '@/stores/conversation-store'
import { twMerge } from 'tailwind-merge'

declare const JAN_API_BASE_URL: string

function ThreadPageContent() {
  const params = useParams({ strict: false })
  const conversationId = params.conversationId as string | undefined
  const selectedModel = useModels((state) => state.selectedModel)
  const models = useModels((state) => state.models)
  const setSelectedModel = useModels((state) => state.setSelectedModel)
  const getConversation = useConversations((state) => state.getConversation)
  const initialMessageSentRef = useRef(false)
  const reasoningContainerRef = useRef<HTMLDivElement>(null)
  const fetchingMessagesRef = useRef(false)

  const provider = createOpenAICompatible({
    name: 'janhq',
    baseURL: `${JAN_API_BASE_URL}v1`,
    fetch: createAuthenticatedFetch({
      store: true,
      store_reasoning: true,
      conversation: conversationId,
    }),
  })

  const getUIMessages = useConversations((state) => state.getUIMessages)

  const { messages, status, sendMessage, regenerate, setMessages } = useChat(
    provider(selectedModel?.id),
    {
      onFinish: () => {
        // After finishing a message, refresh the conversation list to get updated timestamps
        initialMessageSentRef.current = false
      },
    }
  )

  const handleSubmit = (message: PromptInputMessage) => {
    sendMessage({
      text: message.text || 'Sent with attachments',
      files: message.files,
    })
  }

  useEffect(() => {
    if (conversationId && models.length > 0) {
      getConversation(conversationId)
        .then((conversation) => {
          // Load model from metadata
          const modelId = conversation.metadata?.model_id
          if (modelId) {
            const model = models.find((m) => m.id === modelId)
            if (model && model.id !== selectedModel?.id) {
              setSelectedModel(model)
            }
          }
        })
        .catch((error) => {
          console.error('Failed to load conversation:', error)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, models.length])

  // Check for initial message and send it automatically
  useEffect(() => {
    if (conversationId) {
      const initialMessageKey = `initial-message-${conversationId}`
      const storedMessage = sessionStorage.getItem(initialMessageKey)
      if (storedMessage) {
        try {
          const message: PromptInputMessage = JSON.parse(storedMessage)
          // Clear the stored message
          sessionStorage.removeItem(initialMessageKey)
          // Mark as sent to prevent duplicate sends
          initialMessageSentRef.current = true
          // Send the message
          sendMessage({
            text: message.text,
            files: message.files,
          })
        } catch (error) {
          console.error('Failed to parse initial message:', error)
        }
      }
    }
  }, [conversationId, sendMessage])

  useEffect(() => {
    if (
      conversationId &&
      !initialMessageSentRef.current &&
      !fetchingMessagesRef.current
    ) {
      fetchingMessagesRef.current = true
      // Fetch messages for old conversations
      getUIMessages(conversationId)
        .then((uiMessages) => {
          if (!initialMessageSentRef.current) setMessages(uiMessages)
        })
        .catch((error) => {
          console.error('Failed to load conversation items:', error)
        })
        .finally(() => {
          fetchingMessagesRef.current = false
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (status === 'streaming' && reasoningContainerRef.current) {
      reasoningContainerRef.current.scrollTop =
        reasoningContainerRef.current.scrollHeight
    }
  }, [status, reasoningContainerRef.current?.textContent])

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col h-full overflow-hidden max-h-[calc(100vh-56px)] w-full ">
          {/* Messages Area */}
          <div className="flex-1 relative">
            <Conversation className="absolute inset-0 text-start">
              <ConversationContent className="max-w-3xl mx-auto">
                {messages.map((message, messageIndex) => (
                  <div key={message.id}>
                    {message.parts.map((part, i) => {
                      const isLastMessage = messageIndex === messages.length - 1
                      const isLastPart = i === message.parts.length - 1

                      switch (part.type) {
                        case 'text':
                          return (
                            <Message
                              key={`${message.id}-${i}`}
                              from={message.role}
                            >
                              <MessageContent className="leading-relaxed">
                                <MessageResponse>{part.text}</MessageResponse>
                              </MessageContent>
                              {message.role === 'assistant' &&
                                isLastMessage &&
                                isLastPart && (
                                  <MessageActions className="mt-1 gap-0">
                                    <MessageAction
                                      onClick={() =>
                                        navigator.clipboard.writeText(part.text)
                                      }
                                      label="Copy"
                                    >
                                      <CopyIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                    <MessageAction
                                      onClick={() => regenerate()}
                                      label="Retry"
                                    >
                                      <RefreshCcwIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                    <MessageAction label="Like">
                                      <ThumbsUpIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                    <MessageAction label="Dislike">
                                      <ThumbsDownIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                  </MessageActions>
                                )}
                            </Message>
                          )
                        case 'reasoning':
                          return (
                            <Reasoning
                              key={`${message.id}-${i}`}
                              className="w-full text-muted-foreground"
                              isStreaming={
                                status === 'streaming' &&
                                isLastPart &&
                                isLastMessage
                              }
                              defaultOpen={
                                status === 'streaming' && isLastMessage
                              }
                            >
                              <ReasoningTrigger />
                              <div className="relative">
                                {status === 'streaming' && isLastMessage && (
                                  <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-background to-transparent pointer-events-none z-10" />
                                )}
                                <div
                                  ref={
                                    status === 'streaming' && isLastMessage
                                      ? reasoningContainerRef
                                      : null
                                  }
                                  className={twMerge(
                                    'w-full overflow-auto relative',
                                    status === 'streaming' && isLastMessage
                                      ? 'max-h-32 opacity-70 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                                      : 'h-auto opacity-100'
                                  )}
                                >
                                  <ReasoningContent>
                                    {part.text}
                                  </ReasoningContent>
                                </div>
                              </div>
                            </Reasoning>
                          )
                        default:
                          return null
                      }
                    })}
                  </div>
                ))}
                {status === 'submitted' && <Loader />}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>

          {/* Chat Input - Fixed at bottom */}
          <div className="px-4 py-4 max-w-3xl mx-auto w-full">
            <ChatInput
              conversationId={conversationId}
              submit={handleSubmit}
              status={status}
            />
          </div>
        </div>
      </SidebarInset>
    </>
  )
}

function ThreadPage() {
  return (
    <SidebarProvider>
      <ThreadPageContent />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/threads/$conversationId')({
  component: ThreadPage,
})

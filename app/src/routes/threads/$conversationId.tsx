import { createFileRoute, useParams } from '@tanstack/react-router'

import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import { useChat } from '@/hooks/use-chat'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { useAuth } from '@/stores/auth-store'
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
import { RefreshCcwIcon, CopyIcon, Loader } from 'lucide-react'
import { useModels } from '@/stores/models-store'
import { useEffect, useRef } from 'react'

declare const JAN_API_BASE_URL: string

function ThreadPageContent() {
  const params = useParams({ strict: false })
  const conversationId = params.conversationId as string | undefined
  const selectedModel = useModels((state) => state.selectedModel)
  const initialMessageSentRef = useRef(false)

  const accessToken = useAuth(() => useAuth.getState().accessToken)

  const provider = createOpenAICompatible({
    name: 'janhq',
    apiKey: accessToken ?? '',
    baseURL: `${JAN_API_BASE_URL}v1`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const { messages, status, sendMessage, regenerate } = useChat(
    provider(selectedModel?.id)
  )

  const handleSubmit = (message: PromptInputMessage) => {
    sendMessage(
      {
        text: message.text || 'Sent with attachments',
        files: message.files,
      },
      {
        body: {
          model: selectedModel.id,
          stream: true,
          store_reasoning: true,
          store: true,
        },
      }
    )
  }

  // Check for initial message and send it automatically
  useEffect(() => {
    if (conversationId && !initialMessageSentRef.current) {
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
          sendMessage(
            {
              text: message.text || 'Sent with attachments',
              files: message.files,
            },
            {
              body: {
                model: selectedModel.id,
                stream: true,
                store_reasoning: true,
                store: true,
              },
            }
          )
        } catch (error) {
          console.error('Failed to parse initial message:', error)
        }
      }
    }
  }, [conversationId, sendMessage, selectedModel])

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col h-full gap-4 px-4 pt-10 pb-4 max-w-3xl w-full mx-auto">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto">
            <Conversation className="h-full text-start">
              <ConversationContent>
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.parts.map((part, i) => {
                      switch (part.type) {
                        case 'text':
                          return (
                            <Message
                              key={`${message.id}-${i}`}
                              from={message.role}
                            >
                              <MessageContent>
                                <MessageResponse>{part.text}</MessageResponse>
                              </MessageContent>
                              {message.role === 'assistant' &&
                                i === messages.length - 1 && (
                                  <MessageActions>
                                    <MessageAction
                                      onClick={() => regenerate()}
                                      label="Retry"
                                    >
                                      <RefreshCcwIcon className="size-3" />
                                    </MessageAction>
                                    <MessageAction
                                      onClick={() =>
                                        navigator.clipboard.writeText(part.text)
                                      }
                                      label="Copy"
                                    >
                                      <CopyIcon className="size-3" />
                                    </MessageAction>
                                  </MessageActions>
                                )}
                            </Message>
                          )
                        case 'reasoning':
                          return (
                            <Reasoning
                              key={`${message.id}-${i}`}
                              className="w-full"
                              isStreaming={
                                status === 'streaming' &&
                                i === message.parts.length - 1 &&
                                message.id === messages.at(-1)?.id
                              }
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
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

          {/* Chat Input */}
          <ChatInput conversationId={conversationId} submit={handleSubmit} />
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

/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/no-explicit-any */
import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'
import { useChat } from '@/hooks/use-chat'
import { janProvider } from '@/lib/api-client'
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
  MessageAttachments,
  MessageAttachment,
} from '@/components/ai-elements/message'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { CopyIcon, Loader, CheckIcon } from 'lucide-react'
import { useModels } from '@/stores/models-store'
import { useEffect, useRef, useState } from 'react'
import { useConversations } from '@/stores/conversation-store'
import { twMerge } from 'tailwind-merge'
import { mcpService } from '@/services/mcp-service'
import { useCapabilities } from '@/stores/capabilities-store'
import { cn } from '@/lib/utils'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'

interface ThreadPageContentProps {
  conversationId?: string
  isPrivateChat?: boolean
}

export function ThreadPageContent({
  conversationId,
  isPrivateChat = false,
}: ThreadPageContentProps) {
  const selectedModel = useModels((state) => state.selectedModel)
  const models = useModels((state) => state.models)
  const setSelectedModel = useModels((state) => state.setSelectedModel)
  const getConversation = useConversations((state) => state.getConversation)
  const initialMessageSentRef = useRef(false)
  const reasoningContainerRef = useRef<HTMLDivElement>(null)
  const fetchingMessagesRef = useRef(false)
  const deepResearchEnabled = useCapabilities(
    (state) => state.deepResearchEnabled
  )
  const enableThinking = useCapabilities((state) => state.reasoningEnabled)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)

  const provider = janProvider(
    conversationId,
    deepResearchEnabled,
    isPrivateChat,
    enableThinking
  )

  const getUIMessages = useConversations((state) => state.getUIMessages)
  const tools = useRef<any>([])

  const {
    messages,
    status,
    sendMessage,
    // regenerate,
    setMessages,
    addToolOutput,
    stop,
  } = useChat(provider(selectedModel?.id), {
    onFinish: () => {
      initialMessageSentRef.current = false
      // After finishing a message, check if we need to resubmit for tool calls
      Promise.all(
        tools.current.map(async (toolCall: any) => {
          const result = await mcpService.callTool(
            {
              toolName: toolCall.toolName,
              serverName: 'Jan MCP Server',
              arguments: toolCall.input as any,
            },
            {
              conversationId,
              toolCallId: toolCall.toolCallId,
            }
          )
          if (result.error) {
            addToolOutput({
              state: 'output-error',
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              errorText: result.error,
            })
          } else {
            addToolOutput({
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              output: result.content,
            })
          }
        })
      ).then(() => {
        tools.current = []
      })
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      tools.current.push(toolCall)
      return
    },
  })

  const handleSubmit = (message?: PromptInputMessage) => {
    if (message) {
      tools.current = []
      sendMessage({
        text: message.text || 'Sent with attachments',
        files: message.files,
      })
    } else if (status === 'streaming') {
      stop()
    }
  }

  // Load conversation metadata (only for persistent conversations)
  useEffect(() => {
    if (conversationId && !isPrivateChat && models.length > 0) {
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
  }, [conversationId, models.length, isPrivateChat])

  // Check for initial message and send it automatically
  useEffect(() => {
    const initialMessageKey = isPrivateChat
      ? 'initial-message-temporary'
      : `initial-message-${conversationId}`
    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage && (isPrivateChat || conversationId)) {
      try {
        const message: PromptInputMessage = JSON.parse(storedMessage)
        // Clear the stored message
        sessionStorage.removeItem(initialMessageKey)
        // Mark as sent to prevent duplicate sends
        initialMessageSentRef.current = true
        tools.current = []
        // Send the message
        sendMessage({
          text: message.text,
          files: message.files,
        })
      } catch (error) {
        console.error('Failed to parse initial message:', error)
      }
    }
  }, [conversationId, isPrivateChat, sendMessage])

  // Fetch messages for old conversations (only for persistent conversations)
  useEffect(() => {
    if (
      conversationId &&
      !isPrivateChat &&
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
  }, [conversationId, isPrivateChat])

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
                      const isFirstMessage = messageIndex === 0
                      const isLastMessage = messageIndex === messages.length - 1
                      const isLastPart = i === message.parts.length - 1
                      switch (part.type) {
                        case 'text':
                          return (
                            <Message
                              key={`${message.id}-${i}`}
                              from={message.role}
                              className={cn(
                                isFirstMessage &&
                                  message.role === 'user' &&
                                  'mt-0!'
                              )}
                            >
                              <MessageContent className="leading-relaxed">
                                <MessageResponse>{part.text}</MessageResponse>
                              </MessageContent>
                              {message.role === 'assistant' &&
                                isLastMessage &&
                                isLastPart && (
                                  <MessageActions className="mt-1 gap-0">
                                    <MessageAction
                                      onClick={() => {
                                        navigator.clipboard.writeText(
                                          part.text.trim()
                                        )
                                        setCopiedMessageId(message.id)
                                        setTimeout(
                                          () => setCopiedMessageId(null),
                                          2000
                                        )
                                      }}
                                      label="Copy"
                                    >
                                      {copiedMessageId === message.id ? (
                                        <CheckIcon className="text-green-600 dark:text-green-400 size-3" />
                                      ) : (
                                        <CopyIcon className="text-muted-foreground size-3" />
                                      )}
                                    </MessageAction>
                                    {/* <MessageAction
                                      onClick={() => regenerate()}
                                      label="Retry"
                                    >
                                      <RefreshCcwIcon className="text-muted-foreground size-3" />
                                    </MessageAction> */}
                                    {/* Temporary hide till we have function */}
                                    {/* <MessageAction label="Like">
                                      <ThumbsUpIcon className="text-muted-foreground size-3" />
                                    </MessageAction> */}
                                    {/* <MessageAction label="Dislike">
                                      <ThumbsDownIcon className="text-muted-foreground size-3" />
                                    </MessageAction> */}
                                  </MessageActions>
                                )}
                            </Message>
                          )
                        case 'file':
                          return (
                            <MessageAttachments className="mb-2">
                              <MessageAttachment
                                data={part}
                                key={part.filename || 'image'}
                              />
                            </MessageAttachments>
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
                          // Handle all tool-* cases (tool-call, tool-result, etc.)
                          if (!part.type.startsWith('tool-')) {
                            return null
                          }
                          // Type narrowing: ensure part has tool-related properties
                          if (!('state' in part)) {
                            return null
                          }
                          // Extract tool name from the type (e.g., 'tool-call-web_search' -> 'web_search')
                          const toolName = part.type
                            .split('-')
                            .slice(1)
                            .join('-')
                          return (
                            <Tool key={`${message.id}-${i}`}>
                              <ToolHeader
                                title={toolName}
                                type={part.type as `tool-${string}`}
                                state={part.state}
                              />
                              <ToolContent>
                                {<ToolInput input={part.input} />}
                                {part.state === 'output-available' &&
                                  'output' in part && (
                                    <ToolOutput
                                      output={part.output}
                                      errorText={
                                        'errorText' in part
                                          ? part.errorText
                                          : undefined
                                      }
                                    />
                                  )}
                                {part.state === 'output-error' && (
                                  <ToolOutput
                                    output={undefined}
                                    errorText={
                                      'errorText' in part
                                        ? part.errorText
                                        : undefined
                                    }
                                  />
                                )}
                              </ToolContent>
                            </Tool>
                          )
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
              submit={handleSubmit}
              status={tools.current.length > 0 ? 'streaming' : status}
              conversationId={conversationId}
            />
          </div>
        </div>
      </SidebarInset>
    </>
  )
}

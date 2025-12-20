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
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { Loader } from 'lucide-react'
import { useModels } from '@/stores/models-store'
import { useEffect, useRef, useState } from 'react'
import { useConversations } from '@/stores/conversation-store'
import { mcpService } from '@/services/mcp-service'
import { useCapabilities } from '@/stores/capabilities-store'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from 'ai'
import { MessageItem } from './message-item'
import { ThreadSkeleton } from './thread-skeleton'

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
  const [isLoadingMessages, setIsLoadingMessages] = useState(!isPrivateChat)
  const deepResearchEnabled = useCapabilities(
    (state) => state.deepResearchEnabled
  )
  const enableThinking = useCapabilities((state) => state.reasoningEnabled)

  const provider = janProvider(
    conversationId,
    deepResearchEnabled,
    isPrivateChat,
    enableThinking
  )

  const getUIMessages = useConversations((state) => state.getUIMessages)
  const tools = useRef<any>([])
  const messagesRef = useRef<UIMessage[]>([])
  const idMapRef = useRef<Map<string, string>>(new Map()) // temp ID -> real ID

  const {
    messages,
    status,
    sendMessage,
    regenerate,
    setMessages,
    addToolOutput,
    stop,
  } = useChat(provider(selectedModel?.id), {
    experimental_throttle: 50,
    onFinish: () => {
      initialMessageSentRef.current = false
      const hadToolCalls = tools.current.length > 0
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
      )
        .then(() => {
          if (conversationId && !isPrivateChat && !hadToolCalls) {
            // Build ID mapping without updating state to avoid scroll jump
            getUIMessages(conversationId)
              .then((backendMessages) => {
                const currentMessages = messagesRef.current
                currentMessages.forEach((msg, index) => {
                  const backendMsg = backendMessages[index]
                  if (backendMsg && msg.id !== backendMsg.id) {
                    idMapRef.current.set(msg.id, backendMsg.id)
                  }
                })
              })
              .catch(console.error)
          }
        })
        .finally(() => {
          tools.current = []
        })
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      tools.current.push(toolCall)
      return
    },
  })

  // Keep ref in sync for use in onFinish closure
  messagesRef.current = messages

  // Resolve temp ID to real backend ID
  const resolveMessageId = (tempId: string) =>
    idMapRef.current.get(tempId) ?? tempId

  const regenerateMessage = useConversations((state) => state.regenerateMessage)

  const handleRegenerate = async (messageId: string) => {
    if (!conversationId) return
    try {
      const realId = resolveMessageId(messageId)
      const response = await regenerateMessage(conversationId, realId)

      if (response.branch_created && response.branch) {
        // Start regeneration immediately - don't wait for getUIMessages
        setTimeout(() => regenerate(), 0)

        // Fetch IDs in background for future operations
        getUIMessages(conversationId, response.branch)
          .then((branchMessages) => {
            const currentMessages = messagesRef.current
            const regenIndex = currentMessages.findIndex((m) => m.id === messageId)

            // Build ID mapping in background
            branchMessages.forEach((branchMsg, i) => {
              const current = currentMessages[i]
              if (i < regenIndex && current && current.id !== branchMsg.id) {
                idMapRef.current.set(current.id, branchMsg.id)
              }
            })
          })
          .catch(console.error)
      }
    } catch (error) {
      console.error('Failed to regenerate:', error)
    }
  }

  const handleSubmit = (message?: PromptInputMessage) => {
    if (message && status !== 'streaming') {
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
      setIsLoadingMessages(true)
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
          setIsLoadingMessages(false)
        })
    } else if (isPrivateChat) {
      setIsLoadingMessages(false)
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
                {isLoadingMessages ? (
                  <ThreadSkeleton />
                ) : (
                  <>
                    {messages.map((message, messageIndex) => (
                      <MessageItem
                        key={message.id}
                        message={message}
                        isFirstMessage={messageIndex === 0}
                        isLastMessage={messageIndex === messages.length - 1}
                        status={status}
                        reasoningContainerRef={reasoningContainerRef}
                        onRegenerate={conversationId ? handleRegenerate : undefined}
                      />
                    ))}
                    {status === 'submitted' && <Loader />}
                  </>
                )}
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

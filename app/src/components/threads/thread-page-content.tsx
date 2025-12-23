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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConversations } from '@/stores/conversation-store'
import { mcpService } from '@/services/mcp-service'
import { useCapabilities } from '@/stores/capabilities-store'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIDataTypes, UIMessage, UITools } from 'ai'
import { MessageItem } from './message-item'
import {
  findPrecedingUserMessageIndex,
  buildIdMapping,
  resolveMessageId,
} from '@/lib/message-utils'
import { convertToUIMessages } from '@/lib/utils'

// Scroll animation config (spring physics) - a tad slower than default
const SCROLL_MASS = 1.35 // inertia, higher = slower (default: 1.25)
const SCROLL_DAMPING = 0.72 // 0-1, higher = less bouncy (default: 0.7)
const SCROLL_STIFFNESS = 0.045 // acceleration, lower = gentler (default: 0.05)

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
  const [conversationTitle, setConversationTitle] = useState<string>('')

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
  const toolCallAbortController = useRef<AbortController | null>(null)

  const followUpMessage = ({
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
  }

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

      // Create a new AbortController for tool calls
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      // After finishing a message, check if we need to resubmit for tool calls
      Promise.all(
        tools.current.map(async (toolCall: any) => {
          // Check if already aborted before starting
          if (signal.aborted) {
            return
          }

          const result = await mcpService.callTool(
            {
              toolName: toolCall.toolName,
              serverName: 'Jan MCP Server',
              arguments: toolCall.input as any,
            },
            {
              conversationId,
              toolCallId: toolCall.toolCallId,
              signal, // Pass abort signal to tool call
            }
          )

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
        })
      )
        .then(() => {
          if (conversationId && !isPrivateChat && !hadToolCalls) {
            // Build ID mapping without updating state to avoid scroll jump
            getUIMessages(conversationId)
              .then((backendMessages) => {
                buildIdMapping(
                  messagesRef.current,
                  backendMessages,
                  idMapRef.current
                )
              })
              .catch(console.error)
          }
        })
        .catch((error) => {
          // Ignore abort errors
          if (error.name !== 'AbortError') {
            console.error('Tool call error:', error)
          }
        })
        .finally(() => {
          tools.current = []
          toolCallAbortController.current = null
        })
    },
    sendAutomaticallyWhen: followUpMessage,
    onToolCall: ({ toolCall }) => {
      tools.current.push(toolCall)
      return
    },
  })

  // Keep ref in sync for use in onFinish closure
  messagesRef.current = messages

  const regenerateMessage = useConversations((state) => state.regenerateMessage)

  const handleRegenerate = async (messageId: string) => {
    if (!conversationId) return
    try {
      const realId = resolveMessageId(messageId, idMapRef.current)
      const currentMessages = messagesRef.current

      // Find the clicked assistant message index
      const assistantIndex = currentMessages.findIndex(
        (m) => m.id === messageId
      )
      if (assistantIndex === -1) return

      // Find the preceding user message
      const userIndex = findPrecedingUserMessageIndex(
        currentMessages,
        assistantIndex
      )
      if (userIndex === -1) return

      // Call server to create branch (for persistence)
      const response = await regenerateMessage(conversationId, realId)

      if (response.branch_created && response.branch) {
        // Truncate local messages to keep only messages up to and including the user message
        const truncatedMessages = currentMessages.slice(0, userIndex + 1)
        setMessages(truncatedMessages)

        // Now regenerate - AI SDK will regenerate response for the last user message
        setTimeout(() => regenerate(), 0)

        // Fetch IDs in background for future operations
        getUIMessages(conversationId, response.branch)
          .then((branchMessages) => {
            buildIdMapping(truncatedMessages, branchMessages, idMapRef.current)
          })
          .catch(console.error)
      }
    } catch (error) {
      console.error('Failed to regenerate:', error)
    }
  }

  const handleSubmit = useCallback(
    (message?: PromptInputMessage) => {
      if (message && status !== 'streaming') {
        tools.current = []
        sendMessage({
          text: message.text || 'Sent with attachments',
          files: message.files,
        })
      } else if (status === 'streaming') {
        stop()
      } else {
        if (toolCallAbortController.current) {
          toolCallAbortController.current.abort()
          toolCallAbortController.current = null
          tools.current = []
        }
      }
    },
    [sendMessage, status, stop]
  )

  // Load conversation metadata (only for persistent conversations)
  useEffect(() => {
    if (conversationId && !isPrivateChat && models.length > 0) {
      getConversation(conversationId)
        .then((conversation) => {
          // Store conversation title for share dialog
          setConversationTitle(conversation.title)

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

        // Preload cached items if any
        const initialItemsKey = `initial-items-${conversationId}`
        const cachedItems = sessionStorage.getItem(initialItemsKey)
        if (cachedItems) {
          const items = JSON.parse(cachedItems) as any[]
          setMessages(convertToUIMessages(items))
          sessionStorage.removeItem(initialItemsKey)
        }

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
      // Clear messages first, then fetch (like ChatGPT)
      setMessages([])
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
        <NavHeader
          conversationId={conversationId}
          conversationTitle={conversationTitle}
        />
        <div className="flex flex-1 flex-col h-full overflow-hidden max-h-[calc(100vh-56px)] w-full ">
          {/* Messages Area */}
          <div className="flex-1 relative">
            <Conversation
              className="absolute inset-0 text-start"
              mass={SCROLL_MASS}
              damping={SCROLL_DAMPING}
              stiffness={SCROLL_STIFFNESS}
            >
              <ConversationContent className="max-w-3xl mx-auto">
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

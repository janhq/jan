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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConversations } from '@/stores/conversation-store'
import { mcpService } from '@/services/mcp-service'
import { useCapabilities } from '@/stores/capabilities-store'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIDataTypes, UIMessage, UITools } from 'ai'
import { MessageItem } from './message-item'
import {
  findPrecedingUserMessageIndex,
  findFollowingAssistantMessageIndex,
  buildIdMapping,
  resolveMessageId,
} from '@/lib/message-utils'
import { convertToUIMessages } from '@/lib/utils'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  PRIVATE_CHAT_SESSION_ID,
  TEMPORARY_CHAT_SESSION_ID,
  SCROLL_ANIMATION,
  MCP,
  TOOL_STATE,
  CHAT_STATUS,
  CONTENT_TYPE,
  SESSION_STORAGE_KEY,
  SESSION_STORAGE_PREFIX,
  MESSAGE_ROLE,
} from '@/constants'

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
  const deepResearchEnabled = useCapabilities(
    (state) => state.deepResearchEnabled
  )
  const enableThinking = useCapabilities((state) => state.reasoningEnabled)
  const [conversationTitle, setConversationTitle] = useState<string>('')

  const provider = useMemo(
    () => janProvider(conversationId, deepResearchEnabled, isPrivateChat, enableThinking),
    [conversationId, deepResearchEnabled, isPrivateChat, enableThinking]
  )

  const getUIMessages = useConversations((state) => state.getUIMessages)
  const fetchingMessagesRef = useRef(false)
  const moveConversationToTop = useConversations(
    (state) => state.moveConversationToTop
  )
  const getSessionData = useChatSessions((state) => state.getSessionData)

  const chatSessionId =
    conversationId ??
    (isPrivateChat ? PRIVATE_CHAT_SESSION_ID : TEMPORARY_CHAT_SESSION_ID)
  // sessionData is a mutable ref-like object - direct mutations don't trigger re-renders (intentional)
  const sessionData = getSessionData(chatSessionId)

  // AbortController for cancelling tool calls (kept as ref since it's a signal, not session data)
  const toolCallAbortController = useRef<AbortController | null>(null)

  // Helper to get current messages for this session
  const getCurrentMessages = useCallback(() => {
    const state = useChatSessions.getState()
    const session = state.sessions[chatSessionId]
    return (
      session?.chat.messages ?? state.getSessionData(chatSessionId).messages
    )
  }, [chatSessionId])

  // Check if we should follow up with tool calls (respects abort signal)
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
    sessionId: chatSessionId,
    sessionTitle: conversationTitle || undefined,
    onFinish: ({ message, isAbort }) => {
      // Note: These values are captured at Chat creation time, which is correct
      // because onFinish fires for the Chat that started the stream, not the current conversation
      initialMessageSentRef.current = false
      const hadToolCalls = sessionData.tools.length > 0

      // Create a new AbortController for tool calls
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      // Check whether this is a valid message otherwise continue
      const needFollowUp =
        !hadToolCalls &&
        !isAbort &&
        message?.parts.some((e) => e.type === CONTENT_TYPE.REASONING) &&
        !message?.parts.some((e) => e.type === CONTENT_TYPE.TEXT && e.text.length > 0)
      // After finishing a message, check if we need to resubmit for tool calls
      Promise.all(
        sessionData.tools.map(async (toolCall: any) => {
          // Check if already aborted before starting
          if (signal.aborted) {
            return
          }

          const result = await mcpService.callTool(
            {
              toolName: toolCall.toolName,
              serverName: MCP.SERVER_NAME,
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
              state: TOOL_STATE.OUTPUT_ERROR,
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
          // Continue generate if need follow up on a blank message
          if (needFollowUp) {
            sendMessage()
          } else if (conversationId && !isPrivateChat && !hadToolCalls) {
            // Build ID mapping without updating state to avoid scroll jump
            getUIMessages(conversationId)
              .then((backendMessages) => {
                buildIdMapping(
                  getCurrentMessages(),
                  backendMessages,
                  sessionData.idMap
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
          sessionData.tools = []
          toolCallAbortController.current = null
        })
    },
    sendAutomaticallyWhen: followUpMessage,
    onToolCall: ({ toolCall }) => {
      sessionData.tools.push(toolCall)
      return
    },
  })

  // Keep ref in sync for use in onFinish closure
  useEffect(() => {
    sessionData.messages = messages
  }, [messages, sessionData])

  const regenerateMessage = useConversations((state) => state.regenerateMessage)

  const executeRegenerate = useCallback(
    async (realId: string, userIndex: number) => {
      if (!conversationId) return

      const response = await regenerateMessage(conversationId, realId)

      if (response.branch_created && response.branch) {
        const currentMessages = getCurrentMessages()
        const truncatedMessages = currentMessages.slice(0, userIndex + 1)
        setMessages(truncatedMessages)

        setTimeout(() => regenerate(), 0)

        getUIMessages(conversationId, response.branch)
          .then((branchMessages) => {
            buildIdMapping(truncatedMessages, branchMessages, sessionData.idMap)
          })
          .catch(console.error)
      }
    },
    [conversationId, regenerateMessage, getCurrentMessages, setMessages, regenerate, getUIMessages, sessionData.idMap]
  )

  const handleRegenerateUserMessage = useCallback(
    async (messageId: string, messageIndex: number) => {
      const currentMessages = getCurrentMessages()
      const mappedId = sessionData.idMap.get(messageId)

      if (mappedId) {
        // Has backend ID - use user message directly
        await executeRegenerate(mappedId, messageIndex)
      } else {
        // No backend ID - find following assistant message
        const assistantIndex = findFollowingAssistantMessageIndex(
          currentMessages,
          messageIndex
        )
        if (assistantIndex === -1) {
          // No assistant message after - just trigger normal generation
          const truncatedMessages = currentMessages.slice(0, messageIndex + 1)
          setMessages(truncatedMessages)
          setTimeout(() => regenerate(), 0)
          return
        }
        const assistantId = currentMessages[assistantIndex].id
        const realId = resolveMessageId(assistantId, sessionData.idMap)
        await executeRegenerate(realId, messageIndex)
      }
    },
    [getCurrentMessages, sessionData.idMap, executeRegenerate, setMessages, regenerate]
  )

  const handleRegenerateAssistantMessage = useCallback(
    async (messageId: string, messageIndex: number) => {
      const currentMessages = getCurrentMessages()
      const realId = resolveMessageId(messageId, sessionData.idMap)
      const userIndex = findPrecedingUserMessageIndex(currentMessages, messageIndex)
      if (userIndex === -1) return

      await executeRegenerate(realId, userIndex)
    },
    [getCurrentMessages, sessionData.idMap, executeRegenerate]
  )

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!conversationId) return
      try {
        const currentMessages = getCurrentMessages()
        const messageIndex = currentMessages.findIndex((m) => m.id === messageId)
        if (messageIndex === -1) return

        const message = currentMessages[messageIndex]

        if (message.role === MESSAGE_ROLE.USER) {
          await handleRegenerateUserMessage(messageId, messageIndex)
        } else if (message.role === MESSAGE_ROLE.ASSISTANT) {
          await handleRegenerateAssistantMessage(messageId, messageIndex)
        }
      } catch (error) {
        console.error('Failed to regenerate:', error)
      }
    },
    [conversationId, getCurrentMessages, handleRegenerateUserMessage, handleRegenerateAssistantMessage]
  )

  const handleSubmit = useCallback(
    (message?: PromptInputMessage) => {
      // Get the current session to check its status directly
      const currentSession = useChatSessions.getState().sessions[chatSessionId]
      const currentStatus = currentSession?.status ?? status

      if (message && currentStatus !== CHAT_STATUS.STREAMING && currentStatus !== CHAT_STATUS.SUBMITTED) {
        sessionData.tools = []
        sendMessage({
          text: message.text || 'Sent with attachments',
          files: message.files,
        })
        // Move conversation to top when a new message is sent
        if (conversationId && !isPrivateChat) {
          moveConversationToTop(conversationId)
        }
      } else if (currentStatus === CHAT_STATUS.STREAMING || currentStatus === CHAT_STATUS.SUBMITTED) {
        stop()
      } else {
        // Stop pending tool calls when user clicks stop (not streaming but tools are running)
        if (toolCallAbortController.current) {
          toolCallAbortController.current.abort()
          toolCallAbortController.current = null
          sessionData.tools = []
        }
      }
    },
    [chatSessionId, sendMessage, sessionData, status, stop, conversationId, isPrivateChat, moveConversationToTop]
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

  // Reset state when conversation changes
  useEffect(() => {
    initialMessageSentRef.current = false
  }, [conversationId])

  useEffect(() => {
    const initialMessageKey = isPrivateChat
      ? SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY
      : `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${conversationId}`

    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage && (isPrivateChat || conversationId)) {
      try {
        const message: PromptInputMessage = JSON.parse(storedMessage)
        // Clear the stored message
        sessionStorage.removeItem(initialMessageKey)
        // Mark as sent to prevent duplicate sends
        initialMessageSentRef.current = true
        sessionData.tools = []

        // Preload cached items if any
        const initialItemsKey = `${SESSION_STORAGE_PREFIX.INITIAL_ITEMS}${conversationId}`
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
        // Move conversation to top when initial message is sent
        if (conversationId && !isPrivateChat) {
          moveConversationToTop(conversationId)
        }
      } catch (error) {
        console.error('Failed to parse initial message:', error)
      }
    }
  }, [conversationId, isPrivateChat, sendMessage, sessionData, setMessages, moveConversationToTop])

  // Fetch messages for old conversations (only for persistent conversations)
  useEffect(() => {
    if (
      conversationId &&
      !isPrivateChat &&
      !initialMessageSentRef.current &&
      !fetchingMessagesRef.current
    ) {
      // Check if session already has messages (e.g., returning to a streaming conversation)
      const existingSession = useChatSessions.getState().sessions[chatSessionId]
      if (
        existingSession?.chat.messages.length > 0 ||
        existingSession?.isStreaming
      ) {
        // Don't overwrite existing messages - session already has data
        return
      }

      fetchingMessagesRef.current = true
      // Clear messages first, then fetch (like ChatGPT)
      setMessages([])
      getUIMessages(conversationId)
        .then((uiMessages) => {
          // Double-check session state hasn't changed during async fetch
          const currentSession =
            useChatSessions.getState().sessions[chatSessionId]
          if (currentSession?.isStreaming) {
            return // Don't overwrite if streaming started
          }
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
  }, [conversationId, isPrivateChat, chatSessionId])

  // Auto-scroll reasoning container to bottom during streaming
  useEffect(() => {
    if (status === CHAT_STATUS.STREAMING && reasoningContainerRef.current) {
      reasoningContainerRef.current.scrollTop =
        reasoningContainerRef.current.scrollHeight
    }
  }, [status, messages])

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
              mass={SCROLL_ANIMATION.MASS}
              damping={SCROLL_ANIMATION.DAMPING}
              stiffness={SCROLL_ANIMATION.STIFFNESS}
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
                {status === CHAT_STATUS.SUBMITTED && <Loader />}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>

          {/* Chat Input - Fixed at bottom */}
          <div className="px-4 py-4 max-w-3xl mx-auto w-full">
            <ChatInput
              submit={handleSubmit}
              status={sessionData.tools.length > 0 ? CHAT_STATUS.STREAMING : status}
              conversationId={conversationId}
            />
          </div>
        </div>
      </SidebarInset>
    </>
  )
}

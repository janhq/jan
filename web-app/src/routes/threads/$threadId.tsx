import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

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
import { useAppState } from '@/hooks/useAppState'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { SESSION_STORAGE_PREFIX } from '@/constants/chat'
import { useChat } from '@/hooks/use-chat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { renderInstructions } from '@/lib/instructionTemplate'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/ai-elements/conversation'
import { generateId, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
} from '@/lib/messages'
import { newUserThreadContent } from '@/lib/completion'
import { ThreadMessage, MessageStatus, ChatCompletionRole } from '@janhq/core'
import { createImageAttachment } from '@/types/attachment'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/useChatAttachments'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useAttachments } from '@/hooks/useAttachments'
import { PromptProgress } from '@/components/PromptProgress'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { Button } from '@/components/ui/button'
import { IconAlertCircle } from '@tabler/icons-react'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const currentAssistant = useAssistant((state) => state.currentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const currentThread = useRef<string | undefined>(undefined)

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()
  const isMobile = useMobileScreen()
  useTools()

  // Get attachments for this thread
  const attachmentsKey = threadId ?? NEW_THREAD_ATTACHMENT_KEY
  const getAttachments = useChatAttachments((state) => state.getAttachments)
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )

  // Session data for tool call tracking
  const getSessionData = useChatSessions((state) => state.getSessionData)
  const sessionData = getSessionData(threadId)

  // AbortController for cancelling tool calls
  const toolCallAbortController = useRef<AbortController | null>(null)

  // Check if we should follow up with tool calls (respects abort signal)
  const followUpMessage = useCallback(
    ({ messages }: { messages: UIMessage[] }) => {
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
  const providers = useModelProvider((state) => state.providers)

  // Store model metadata in appState for the chat transport
  const setLanguageModel = useAppState((state) => state.setLanguageModel)
  const languageModelId = useAppState((state) => state.languageModelId)
  const languageModelProvider = useAppState(
    (state) => state.languageModelProvider
  )

  useEffect(() => {
    // Wait for providers to be loaded before attempting to set model metadata
    if (providers.length === 0) {
      return
    }

    const provider = getProviderByName(selectedProvider)
    const modelId = selectedModel?.id ?? thread?.model?.id ?? ''
    if (!modelId || !provider) {
      setLanguageModel(null, undefined, undefined)
      return
    }

    // Store model metadata (no need to create LanguageModel here)
    setLanguageModel(null, modelId, provider)
  }, [
    selectedModel?.id,
    thread?.model?.id,
    selectedProvider,
    getProviderByName,
    providers.length,
    setLanguageModel,
  ])

  // Get system message from current assistant's instructions
  const systemMessage = currentAssistant?.instructions
    ? renderInstructions(currentAssistant.instructions)
    : undefined

  // Use the AI SDK chat hook
  const {
    messages: chatMessages,
    status,
    error,
    sendMessage,
    regenerate,
    setMessages: setChatMessages,
    stop,
    addToolOutput,
    updateRagToolsAvailability,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage,
    experimental_throttle: 50,
    onFinish: ({ message, isAbort }) => {
      // Persist assistant message to backend (skip if aborted)
      if (!isAbort && message.role === 'assistant') {
        // Extract content parts (including tool calls) as separate items in the content array
        // This preserves the natural ordering: text -> tool call -> text -> tool call, etc.
        const contentParts = extractContentPartsFromUIMessage(message)

        if (contentParts.length > 0) {
          // Extract metadata from the message (including usage and tokenSpeed)
          const messageMetadata = (message.metadata || {}) as Record<
            string,
            unknown
          >

          // Create assistant message with content parts (including tool calls) and metadata
          const assistantMessage: ThreadMessage = {
            type: 'text',
            role: ChatCompletionRole.Assistant,
            content: contentParts,
            id: message.id,
            object: 'thread.message',
            thread_id: threadId,
            status: MessageStatus.Ready,
            created_at: Date.now(),
            completed_at: Date.now(),
            metadata: messageMetadata,
          }

          // Check if message with this ID already exists (onFinish can be called multiple times)
          const existingMessages = useMessages.getState().getMessages(threadId)
          const existingMessage = existingMessages.find(
            (m) => m.id === message.id
          )

          if (existingMessage) {
            updateMessage(assistantMessage)
          } else {
            addMessage(assistantMessage)
          }
        }
      }

      // Create a new AbortController for tool calls
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      // Get cached tool names from store (initialized in useTools hook)
      const ragToolNames = useAppState.getState().ragToolNames
      const mcpToolNames = useAppState.getState().mcpToolNames

      // Execute all collected tool calls
      Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessionData.tools.map(async (toolCall: any) => {
          // Check if already aborted before starting
          if (signal.aborted) {
            return
          }

          try {
            const toolName = toolCall.toolName
            let result

            // Route to the appropriate service based on tool name
            if (ragToolNames.has(toolName)) {
              result = await serviceHub.rag().callTool({
                toolName,
                arguments: toolCall.input,
                threadId,
              })
            } else if (mcpToolNames.has(toolName)) {
              result = await serviceHub.mcp().callTool({
                toolName,
                arguments: toolCall.input,
              })
            } else {
              // Tool not found in either service
              result = {
                error: `Tool '${toolName}' not found in any service`,
              }
            }

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
    },
    onToolCall: ({ toolCall }) => {
      sessionData.tools.push(toolCall)
    },
    sendAutomaticallyWhen: followUpMessage,
  })

  // Get disabled tools for this thread to trigger re-render when they change
  const disabledTools = useToolAvailable((state) =>
    state.getDisabledToolsForThread(threadId)
  )

  // Update RAG tools availability when documents, model, or tool availability changes
  useEffect(() => {
    const hasDocuments = Boolean(thread?.metadata?.hasDocuments)
    const ragFeatureAvailable = Boolean(
      useAttachments.getState().enabled &&
        PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
    )
    const modelSupportsTools =
      selectedModel?.capabilities?.includes('tools') ?? false

    updateRagToolsAvailability(
      hasDocuments,
      modelSupportsTools,
      ragFeatureAvailable
    )
  }, [
    thread?.metadata?.hasDocuments,
    selectedModel?.capabilities,
    updateRagToolsAvailability,
    disabledTools, // Re-run when tools are enabled/disabled
  ])

  // Ref for reasoning container auto-scroll
  const reasoningContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll reasoning container to bottom during streaming
  useEffect(() => {
    if (status === 'streaming' && reasoningContainerRef.current) {
      reasoningContainerRef.current.scrollTop =
        reasoningContainerRef.current.scrollHeight
    }
  }, [status, chatMessages])

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
      existingSession?.isStreaming ||
      currentThread.current === threadId
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
          currentThread.current = threadId
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

  // Consolidated function to process and send a message
  const processAndSendMessage = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      if (!languageModelId || !languageModelProvider) return

      // Get all attachments from the store (includes both images and documents)
      const allAttachments = getAttachments(attachmentsKey)

      // Convert image files to attachments for persistence
      const imageAttachments = files?.map((file) => {
        const base64 = file.url.split(',')[1] || ''
        return createImageAttachment({
          name: `image-${Date.now()}`,
          mimeType: file.mediaType,
          dataUrl: file.url,
          base64,
          size: Math.ceil((base64.length * 3) / 4), // Estimate size from base64
        })
      })

      // Combine image attachments with document attachments from the store
      const combinedAttachments = [
        ...(imageAttachments || []),
        ...allAttachments.filter((a) => a.type === 'document'),
      ]

      // Process attachments (ingest images, parse/index documents)
      let processedAttachments = combinedAttachments
      if (combinedAttachments.length > 0) {
        try {
          const parsePreference = useAttachments.getState().parseMode
          const result = await processAttachmentsForSend({
            attachments: combinedAttachments,
            threadId,
            serviceHub,
            selectedProvider,
            parsePreference,
          })
          processedAttachments = result.processedAttachments

          // Update thread metadata if documents were embedded
          if (result.hasEmbeddedDocuments) {
            useThreads.getState().updateThread(threadId, {
              metadata: { hasDocuments: true },
            })
          }
        } catch (error) {
          console.error('Failed to process attachments:', error)
          // Don't send message if attachment processing failed
          return
        }
      }

      const messageId = generateId()
      // Create and persist the user message to the backend with all processed attachments
      const userMessage = newUserThreadContent(
        threadId,
        text,
        processedAttachments,
        messageId
      )
      addMessage(userMessage)

      // Build parts for AI SDK (only images are sent as file parts)
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; url: string }
      > = [
        {
          type: 'text',
          text: userMessage.content[0].text?.value ?? text,
        },
      ]

      if (files) {
        files.forEach((file) => {
          parts.push({
            type: 'file',
            mediaType: file.mediaType,
            url: file.url,
          })
        })
      }

      sendMessage({
        parts,
        id: messageId,
        metadata: userMessage.metadata,
      })

      // Clear attachments after sending
      clearAttachmentsForThread(attachmentsKey)
    },
    [
      languageModelId,
      languageModelProvider,
      sendMessage,
      threadId,
      addMessage,
      getAttachments,
      attachmentsKey,
      clearAttachmentsForThread,
      serviceHub,
      selectedProvider,
    ]
  )

  // Check for and send initial message from sessionStorage
  const initialMessageSentRef = useRef(false)
  useEffect(() => {
    // Prevent duplicate sends
    if (initialMessageSentRef.current) return
    if (!languageModelId || !languageModelProvider) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`

    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage) {
      // Mark as sent immediately to prevent duplicate sends
      sessionStorage.removeItem(initialMessageKey)
      initialMessageSentRef.current = true

      // Process message asynchronously
      ;(async () => {
        try {
          const message = JSON.parse(storedMessage) as {
            text: string
            files?: Array<{ type: string; mediaType: string; url: string }>
          }

          await processAndSendMessage(message.text, message.files)
        } catch (error) {
          console.error('Failed to parse initial message:', error)
        }
      })()
    }
  }, [threadId, languageModelId, languageModelProvider, processAndSendMessage])

  // Handle submit from ChatInput
  const handleSubmit = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      await processAndSendMessage(text, files)
    },
    [processAndSendMessage]
  )

  // Handle regenerate from any message (user or assistant)
  // - For user messages: keeps the user message, deletes all after, regenerates assistant response
  // - For assistant messages: finds the closest preceding user message, deletes from there
  const handleRegenerate = (messageId?: string) => {
    if (!languageModelId || !languageModelProvider) {
      console.warn('No language model available')
      return
    }

    const currentLocalMessages = useMessages.getState().getMessages(threadId)

    // If regenerating from a specific message, delete all messages after it
    if (messageId) {
      // Find the message in the current chat messages
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex !== -1) {
        const selectedMessage = currentLocalMessages[messageIndex]

        // If it's an assistant message, find the closest preceding user message
        let deleteFromIndex = messageIndex
        if (selectedMessage.role === 'assistant') {
          // Look backwards to find the closest user message
          for (let i = messageIndex - 1; i >= 0; i--) {
            if (currentLocalMessages[i].role === 'user') {
              deleteFromIndex = i
              break
            }
          }
        }

        // Get all messages after the delete point
        const messagesToDelete = currentLocalMessages.slice(deleteFromIndex + 1)

        // Delete from backend storage
        if (messagesToDelete.length > 0) {
          messagesToDelete.forEach((msg) => {
            deleteMessage(threadId, msg.id)
          })
        }
      }
    }

    // Call the AI SDK regenerate function - it will handle truncating the UI messages
    // and generating a new response from the selected message
    regenerate(messageId ? { messageId } : undefined)
  }

  // Handler for increasing context size
  const handleContextSizeIncrease = useCallback(async () => {
    if (!selectedModel) return

    const updateProvider = useModelProvider.getState().updateProvider
    const provider = getProviderByName(selectedProvider)
    if (!provider) return

    const modelIndex = provider.models.findIndex(
      (m) => m.id === selectedModel.id
    )
    if (modelIndex === -1) return

    const model = provider.models[modelIndex]

    // Increase context length by 50%
    const currentCtxLen =
      (model.settings?.ctx_len?.controller_props?.value as number) ?? 8192
    const newCtxLen = Math.round(Math.max(8192, currentCtxLen) * 1.5)

    const updatedModel = {
      ...model,
      settings: {
        ...model.settings,
        ctx_len: {
          ...(model.settings?.ctx_len ?? {}),
          controller_props: {
            ...(model.settings?.ctx_len?.controller_props ?? {}),
            value: newCtxLen,
          },
        },
      },
    }

    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = updatedModel as Model

    updateProvider(provider.provider, {
      models: updatedModels,
    })

    await serviceHub.models().stopModel(selectedModel.id)

    setTimeout(() => {
      handleRegenerate()
    }, 1000)
  }, [
    selectedModel,
    selectedProvider,
    getProviderByName,
    serviceHub,
  ])

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
              {chatMessages.map((message, index) => {
                const isLastMessage = index === chatMessages.length - 1
                const isFirstMessage = index === 0
                // const showAssistant =
                //   message.role === 'assistant' &&
                //   (isFirstMessage ||
                //     chatMessages[index - 1]?.role !== 'assistant')

                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isFirstMessage={isFirstMessage}
                    isLastMessage={isLastMessage}
                    status={status}
                    reasoningContainerRef={reasoningContainerRef}
                    onRegenerate={handleRegenerate}
                    // showAssistant={showAssistant}
                    // assistant={
                    //   currentAssistant
                    //     ? {
                    //         avatar: currentAssistant.avatar,
                    //         name: currentAssistant.name,
                    //       }
                    //     : undefined
                    // }
                  />
                )
              })}
              {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
              {error && (
                <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/50 bg-destructive/10">
                  <div className="flex items-start gap-3">
                    <IconAlertCircle className="size-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive mb-1">
                        Error generating response
                      </p>
                      <p className="text-sm text-main-view-fg/70">
                        {error.message}
                      </p>
                      {(error.message.toLowerCase().includes('context') &&
                        (error.message.toLowerCase().includes('size') ||
                          error.message.toLowerCase().includes('length') ||
                          error.message.toLowerCase().includes('limit'))) ||
                      error.message === OUT_OF_CONTEXT_SIZE ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={handleContextSizeIncrease}
                        >
                          <IconAlertCircle className="size-4 mr-2" />
                          Increase Context Size
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
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
            onStop={stop}
            chatStatus={status}
          />
        </div>
      </div>
    </div>
  )
}

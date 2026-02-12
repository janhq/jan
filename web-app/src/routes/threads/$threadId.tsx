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
import { useAssistant } from '@/hooks/useAssistant'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useSmallScreen, useMobileScreen } from '@/hooks/useMediaQuery'
import { useTools } from '@/hooks/useTools'
import { useAppState } from '@/hooks/useAppState'
import { SESSION_STORAGE_PREFIX } from '@/constants/chat'
import { useChat } from '@/hooks/use-chat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { renderInstructions } from '@/lib/instructionTemplate'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { generateId, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
} from '@/lib/messages'
import { newUserThreadContent } from '@/lib/completion'
import {
  ThreadMessage,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
} from '@janhq/core'
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
import { IconAlertCircle, IconLayoutSidebarRight } from '@tabler/icons-react'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useIsAgentEnabled, useAgentMode } from '@/hooks/useAgentMode'
import { useOrchestratorState } from '@/hooks/useOrchestratorState'
import { UnifiedProgressPanel } from '@/containers/AgentProgress/UnifiedProgressPanel'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'

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

  // Agent mode state (unified - LLM decides when to use tools)
  const isAgentEnabled = useIsAgentEnabled()
  const agentProjectPath = useAgentMode((s) => s.projectPath)
  const agentWorkingDirectoryMode = useAgentMode((s) => s.workingDirectoryMode)
  const agentCurrentAgent = useAgentMode((s) => s.currentAgent)

  // Debug: Log agent mode state changes
  useEffect(() => {
    console.log('[Agent Mode State]', { isAgentEnabled, agentProjectPath, agentWorkingDirectoryMode, agentCurrentAgent })
  }, [isAgentEnabled, agentProjectPath, agentWorkingDirectoryMode, agentCurrentAgent])

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
  const threadRef = useRef(thread)
  const projectId = threadRef.current?.metadata?.project?.id

  // Get system message from thread's assistant instructions (if thread has an assigned assistant)
  // Only use assistant instructions if the thread was created with one (e.g., via a project)
  const threadAssistant = thread?.assistants?.[0]
  const systemMessage = threadAssistant?.instructions
    ? renderInstructions(threadAssistant.instructions)
    : undefined

  useEffect(() => {
    threadRef.current = thread
  }, [thread])

  // Build agent config for unified mode (LLM decides when to use tools)
  const agentConfig = useMemo(() => {
    // Check if agent is enabled: custom mode with projectPath OR current/workspace mode
    const isEnabled =
      (agentWorkingDirectoryMode === 'custom' && agentProjectPath) ||
      agentWorkingDirectoryMode === 'current' ||
      agentWorkingDirectoryMode === 'workspace'

    if (!isEnabled) return null

    return {
      projectPath: agentProjectPath,
      workingDirectoryMode: agentWorkingDirectoryMode,
      defaultAgent: agentCurrentAgent as 'build' | 'plan' | 'explore',
      autoApproveReadOnly: false,
    }
  }, [agentProjectPath, agentWorkingDirectoryMode, agentCurrentAgent])

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
    agentConfig,
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

      // Process tool calls sequentially, requesting approval for each if needed.
      // Skip tools that have server-side execute functions (e.g. opencode_delegate)
      // — those are already handled by streamText in the transport layer.
      const SERVER_EXECUTED_TOOLS = new Set(['opencode_delegate'])

      ;(async () => {
        for (const toolCall of sessionData.tools) {
          // Check if already aborted before starting
          if (signal.aborted) {
            break
          }

          // Skip tools executed server-side by streamText (they have execute functions)
          if (SERVER_EXECUTED_TOOLS.has(toolCall.toolName)) {
            continue
          }

          try {
            const toolName = toolCall.toolName

            // Request approval if needed (unless auto-approve is enabled)
            const approved = await useToolApproval
              .getState()
              .showApprovalModal(toolName, threadId, toolCall.input)

            if (!approved) {
              // User denied the tool call
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: 'Tool execution denied by user',
              })
              continue
            }

            let result

            // Route to the appropriate service based on tool name
            if (ragToolNames.has(toolName)) {

              result = await serviceHub.rag().callTool({
                toolName,
                arguments: toolCall.input,
                threadId,
                projectId: projectId,
                scope: projectId ? 'project' : 'thread',
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
                errorText: `Error: ${JSON.stringify(error)}`,
              })
            }
          }
        }

        // Clear tools after processing all
        sessionData.tools = []
        toolCallAbortController.current = null
      })().catch((error) => {
        // Ignore abort errors
        if (error.name !== 'AbortError') {
          console.error('Tool call error:', error)
        }
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
    const checkDocumentsAvailability = async () => {
      const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)
      let hasProjectDocuments = false

      // Check if thread belongs to a project and if that project has files
      const projectId = thread?.metadata?.project?.id
      if (projectId) {
        try {
          const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
            ExtensionTypeEnum.VectorDB
          )
          if (ext?.listAttachmentsForProject) {
            const projectFiles = await ext.listAttachmentsForProject(projectId)
            hasProjectDocuments = projectFiles.length > 0
          }
        } catch (error) {
          console.warn('Failed to check project files:', error)
        }
      }

      const hasDocuments = hasThreadDocuments || hasProjectDocuments
      const ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      const modelSupportsTools =
        selectedModel?.capabilities?.includes('tools') ?? false

      updateRagToolsAvailability(
        hasDocuments,
        modelSupportsTools,
        ragFeatureAvailable
      )
    }

    checkDocumentsAvailability()
  }, [
    thread?.metadata?.hasDocuments,
    thread?.metadata?.project?.id,
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
        if (fetchedMessages && fetchedMessages.length > 0) {
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
      const projectId = thread?.metadata?.project?.id
      if (combinedAttachments.length > 0) {
        try {
          const parsePreference = useAttachments.getState().parseMode
          const result = await processAttachmentsForSend({
            attachments: combinedAttachments,
            threadId,
            projectId,
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
      sendMessage,
      threadId,
      thread,
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
  }, [threadId, processAndSendMessage])

  // Handle submit from ChatInput - Unified flow with LLM deciding tool usage
  const handleSubmit = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      console.log('[Agent Mode] Unified flow - sending to chat transport')
      // Always use unified chat flow - LLM decides whether to use tools
      await processAndSendMessage(text, files)
    },
    [processAndSendMessage]
  )

  // Handle regenerate from any message (user or assistant)
  // - For user messages: keeps the user message, deletes all after, regenerates assistant response
  // - For assistant messages: finds the closest preceding user message, deletes from there
  const handleRegenerate = (messageId?: string) => {
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

  // Handle edit message - updates the message and regenerates from it
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const currentLocalMessages = useMessages.getState().getMessages(threadId)
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex === -1) return

      const originalMessage = currentLocalMessages[messageIndex]

      // Update the message content
      const updatedMessage = {
        ...originalMessage,
        content: [
          {
            type: ContentType.Text,
            text: { value: newText, annotations: [] },
          },
        ],
      }
      updateMessage(updatedMessage)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.map((msg) => {
        if (msg.id === messageId) {
          return {
            ...msg,
            parts: [{ type: 'text' as const, text: newText }],
          }
        }
        return msg
      })
      setChatMessages(updatedChatMessages)

      // Only regenerate if the edited message is from the user
      if (updatedMessage.role === 'assistant') return

      // Delete all messages after this one and regenerate
      const messagesToDelete = currentLocalMessages.slice(messageIndex + 1)
      messagesToDelete.forEach((msg) => {
        deleteMessage(threadId, msg.id)
      })

      // Regenerate from the edited message
      regenerate({ messageId })
    },
    [
      threadId,
      updateMessage,
      deleteMessage,
      chatMessages,
      setChatMessages,
      regenerate,
    ]
  )

  // Handle delete message
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessage(threadId, messageId)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.filter(
        (msg) => msg.id !== messageId
      )
      setChatMessages(updatedChatMessages)
    },
    [threadId, deleteMessage, chatMessages, setChatMessages]
  )

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
    handleRegenerate,
  ])

  const threadModel = useMemo(() => thread?.model, [thread])

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <div />
          <AgentPanelToggleButton />
        </div>
      </HeaderPage>
      <div className="flex flex-1 h-full overflow-hidden">
        {/* Main chat area */}
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
                  return (
                    <MessageItem
                      key={message.id}
                      message={message}
                      isFirstMessage={isFirstMessage}
                      isLastMessage={isLastMessage}
                      status={status}
                      reasoningContainerRef={reasoningContainerRef}
                      onRegenerate={handleRegenerate}
                      onEdit={handleEditMessage}
                      onDelete={handleDeleteMessage}
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

        {/* Agent Progress Panel - shown only when agent is actively working */}
        <AgentProgressPanelWrapper />
      </div>
    </div>
  )
}

function AgentPanelToggleButton() {
  const isAgentEnabled = useIsAgentEnabled()
  const panelRevealed = useOrchestratorState((s) => s.panelRevealed)
  const setPanelRevealed = useOrchestratorState((s) => s.setPanelRevealed)

  if (!isAgentEnabled) return null

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full"
      onClick={() => setPanelRevealed(!panelRevealed)}
      aria-label="Toggle agent panel"
    >
      <IconLayoutSidebarRight
        className={cn(
          'relative size-4.5',
          panelRevealed ? 'text-primary' : 'text-muted-foreground'
        )}
      />
    </Button>
  )
}

function AgentProgressPanelWrapper() {
  const isAgentEnabled = useIsAgentEnabled()
  const events = useOrchestratorState((s) => s.events)
  const status = useOrchestratorState((s) => s.status)
  const pendingApproval = useOrchestratorState((s) => s.pendingApproval)
  const activeDelegation = useOrchestratorState((s) => s.activeDelegation)
  const panelRevealed = useOrchestratorState((s) => s.panelRevealed)
  const setPanelRevealed = useOrchestratorState((s) => s.setPanelRevealed)

  // Check if LLM used any tools in this conversation turn
  const hasToolActivity = events.some(
    (e) =>
      e.type.startsWith('tool.') ||
      e.type.startsWith('delegation.') ||
      e.type === 'file.changed'
  )

  // Detect actual agent work (not just 'thinking' which fires for every message)
  const hasAgentWork =
    hasToolActivity ||
    activeDelegation != null ||
    pendingApproval != null ||
    ['executing_tool', 'delegating', 'waiting_approval'].includes(status)

  // Auto-reveal the panel when agent work is detected
  useEffect(() => {
    if (hasAgentWork && !panelRevealed) {
      setPanelRevealed(true)
    }
  }, [hasAgentWork, panelRevealed, setPanelRevealed])

  // Panel stays visible once revealed, until user manually toggles it off
  if (!isAgentEnabled || !panelRevealed) {
    return null
  }

  return <UnifiedProgressPanel />
}

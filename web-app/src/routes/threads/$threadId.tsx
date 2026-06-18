import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useParams, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import HeaderPage from '@/containers/HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useAssistant } from '@/hooks/useAssistant'
import { useTools } from '@/hooks/useTools'
import { useAppState } from '@/hooks/useAppState'
import { useInitialMessage } from '@/hooks/useInitialMessage'
import { useOptimisticUserMessage } from '@/hooks/useOptimisticUserMessage'
import { buildOptimisticUserMessage } from '@/lib/optimisticUserMessage'
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
import { ttftBegin, ttftMark, ttftPreBegin } from '@/lib/ttft-timing'
import {
  ThreadMessage,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
  computeNextCtxLen,
  EngineManager,
  type AIEngine,
} from '@janhq/core'
import { toast } from 'sonner'
import {
  Attachment,
  createImageAttachment,
  createAudioAttachment,
} from '@/types/attachment'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/useChatAttachments'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useAttachments } from '@/hooks/useAttachments'
import { PromptProgress } from '@/components/PromptProgress'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import {
  OUT_OF_CONTEXT_SIZE,
  MODEL_ACCESS_DENIED_TITLE,
  MODEL_ACCESS_DENIED_MESSAGE,
  CONTEXT_OVERFLOW_TITLE,
  CONTEXT_OVERFLOW_MESSAGE,
  OUT_OF_MEMORY_TITLE,
  OUT_OF_MEMORY_MESSAGE,
  isModelAccessError,
  isContextLimitError,
  isOutOfMemoryError,
} from '@/utils/error'
import { captureHandledError } from '@/lib/sentry'
import { Button } from '@/components/ui/button'
import { LinkifiedText } from '@/components/LinkifiedText'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { useToolApproval } from '@/hooks/useToolApproval'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useAgentMode } from '@/hooks/useAgentMode'
import { ArtifactPanel } from '@/containers/ArtifactPanel'
import { useArtifactStore } from '@/stores/artifact-store'
import posthog from 'posthog-js'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

type ThreadModel = {
  id: string
  provider: string
}

type SearchParams = {
  threadModel?: ThreadModel
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    return {
      threadModel: search.threadModel as ThreadModel | undefined,
    }
  },
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const search = useSearch({ from: Route.id })
  const searchThreadModel = search.threadModel
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const currentThread = useRef<string | undefined>(undefined)

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

  // Holds the partial assistant message while the model reloads after a
  // context-limit hit, so the user sees it instead of a blank gap.
  const [pendingContinueMessage, setPendingContinueMessage] =
    useState<UIMessage | null>(null)
  const [isAutoIncreasingContext, setIsAutoIncreasingContext] = useState(false)
  const [contextLimitError, setContextLimitError] = useState<Error | null>(null)

  // Optimistic user message shown while the home → new thread initial-message
  // path indexes attachments. Lives in a shared Zustand store published by
  // ChatInput **before** navigation, so the bubble is visible on the very
  // first paint of ThreadDetail (no empty-conversation flash) and survives
  // React StrictMode's mount → unmount → remount dev cycle. Cleared
  // synchronously right before sendMessage queues the real UIMessage so
  // there is no visual jump.
  const pendingInitialUserMessage = useOptimisticUserMessage(
    (s) => s.byThread[threadId]
  )

  // Refs so onFinish (captured in closure) always calls the latest callbacks
  const handleContextSizeIncreaseRef = useRef<(() => void) | null>(null)
  const setContinueFromContentRef = useRef<((content: string) => void) | null>(
    null
  )

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
    setContinueFromContent,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage,
    experimental_throttle: 16,
    onFinish: ({ message, isAbort }) => {
      const msgMeta = message.metadata as Record<string, unknown> | undefined
      const finishReason = msgMeta?.finishReason as string | undefined

      // Context limit hit: send partial content as prefill so the model continues
      // from where it stopped. The stream wrapper injects it as the first text-delta
      // of the new message, so the user sees the partial text immediately.
      if (!isAbort && finishReason === 'length') {
        const selectedModelState = useModelProvider.getState().selectedModel
        const usage = msgMeta?.usage as
          | { inputTokens?: number; outputTokens?: number }
          | undefined
        const totalTokens =
          (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
        const ctxLen =
          (selectedModelState?.settings?.ctx_len?.controller_props
            ?.value as number) ?? 32768
        const isContextLimit = totalTokens >= ctxLen * 0.9

        if (isContextLimit) {
          const autoIncrease =
            selectedModelState?.settings?.auto_increase_ctx_len
              ?.controller_props?.value ?? true
          if (autoIncrease) {
            const partialText = message.parts
              .filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('')
            if (partialText) {
              setContinueFromContentRef.current?.(partialText)
              // Keep the partial message visible while the model reloads
              setPendingContinueMessage(message)
            }
            handleContextSizeIncreaseRef.current?.()
          } else {
            setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
            // ATO-113: surface context-overflow (auto-increase disabled) to
            // Sentry as a warning with zero-PII numeric context.
            captureHandledError(new Error(OUT_OF_CONTEXT_SIZE), 'warning', {
              feature: 'context_overflow',
              model_id: selectedModelState?.id,
              context_length: ctxLen,
              total_tokens: totalTokens,
            })
          }
        }
        return
      }

      if (!isAbort && message.parts.length) setPendingContinueMessage(null)

      // Persist assistant message to backend (skip if aborted).
      // For continuations, message.parts already contains partial + new content
      // because the stream wrapper prepended the partial text as the first delta.
      if (!isAbort && message.role === 'assistant') {
        const contentParts = extractContentPartsFromUIMessage(message)

        if (contentParts.length > 0) {
          const messageMetadata = (message.metadata || {}) as Record<
            string,
            unknown
          >

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

      // Process tool calls sequentially, requesting approval for each if needed
      ;(async () => {
        for (const toolCall of sessionData.tools) {
          // Check if already aborted before starting
          if (signal.aborted) {
            break
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

  // Note: no unmount cleanup of the optimistic bubble store here. React
  // StrictMode in dev simulates mount → unmount → remount on initial mount;
  // clearing on unmount would wipe the entry between the two mounts and
  // produce the "white screen during indexing" symptom. The store entry is
  // cleared explicitly inside processAndSendMessage (success or error).

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

  // Close the artifact side panel when switching threads or leaving the page
  // so a preview from one conversation never lingers in another.
  useEffect(() => {
    const close = useArtifactStore.getState().close
    close()
    return () => close()
  }, [threadId])

  // Consolidated function to process and send a message
  const processAndSendMessage = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>,
      documentsFromPayload?: Attachment[]
    ) => {
      ttftBegin()
      const persistReady =
        useThreads.getState().awaitThreadPersistence(threadId)
      // Documents may be passed explicitly via the initial-message payload
      // (home → new thread flow). In that case the store has already been
      // cleared synchronously on send to avoid the chip lingering in the
      // input. For in-thread sends no payload is provided and we read the
      // attachments from the store as before.
      const documentAttachments =
        documentsFromPayload ??
        getAttachments(attachmentsKey).filter((a) => a.type === 'document')
      console.log(
        '[processAndSendMessage] attachmentsKey:',
        attachmentsKey,
        'docsSource:',
        documentsFromPayload ? 'payload' : 'store',
        'docs:',
        documentAttachments.length
      )

      // Convert image/audio files to attachments for persistence. Audio is
      // identified by its `audio/*` media type and persisted separately (see
      // newUserThreadContent → metadata.input_audio) so it round-trips when the
      // thread is reloaded.
      const mediaAttachments = files?.map((file) => {
        const base64 = file.url.split(',')[1] || ''
        const size = Math.ceil((base64.length * 3) / 4) // Estimate from base64
        if (file.mediaType?.startsWith('audio/')) {
          return createAudioAttachment({
            name: `audio-${Date.now()}`,
            mimeType: file.mediaType,
            dataUrl: file.url,
            base64,
            size,
          })
        }
        return createImageAttachment({
          name: `image-${Date.now()}`,
          mimeType: file.mediaType,
          dataUrl: file.url,
          base64,
          size,
        })
      })

      // Combine image/audio attachments with document attachments
      const combinedAttachments = [
        ...(mediaAttachments || []),
        ...documentAttachments,
      ]

      // Reuse the messageId reserved by the optimistic bubble (published by
      // ChatInput before navigation) if available; otherwise mint a fresh
      // one. Sharing the id ensures the real UIMessage queued via
      // sendMessage replaces the optimistic bubble in-place without a
      // visual jump.
      const reservedMessage =
        useOptimisticUserMessage.getState().byThread[threadId]
      const messageId = reservedMessage?.id ?? generateId()

      // Safety net: if the optimistic bubble wasn't published (e.g. the
      // user submitted from inside the thread page rather than via
      // ChatInput on home, but it's still the very first message and there
      // are attachments), publish one now so the user doesn't stare at an
      // empty conversation while the document is being indexed.
      const showOptimisticBubble =
        chatMessages.length === 0 && combinedAttachments.length > 0
      if (showOptimisticBubble && !reservedMessage) {
        const optimisticUIMessage = buildOptimisticUserMessage({
          threadId,
          text,
          documents: combinedAttachments,
          messageId,
        })
        if (optimisticUIMessage) {
          useOptimisticUserMessage.getState().set(threadId, optimisticUIMessage)
        }
      }

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
          useOptimisticUserMessage.getState().clear(threadId)
          // Don't send message if attachment processing failed
          return
        }
      }
      ttftMark('beta')

      // Thread row is optimistic on home → new-thread; persistence may still
      // be in flight. Resolves immediately for in-thread sends.
      await persistReady

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

      console.log(
        '[processAndSendMessage] Calling sendMessage with parts:',
        parts.length,
        'messageId:',
        messageId
      )
      // Hide the optimistic bubble in the same synchronous block as
      // sendMessage so React 18 batches both updates and the user sees the
      // real bubble appear in the same position without a flicker.
      useOptimisticUserMessage.getState().clear(threadId)
      sendMessage({
        parts,
        id: messageId,
        metadata: userMessage.metadata,
      })
      console.log('[processAndSendMessage] sendMessage called successfully')

      posthog.capture('chat_request_sent', {
        source: 'chat',
        thread_id: threadId,
        model_id: selectedModel?.id,
        provider: selectedProvider,
        has_attachments: processedAttachments.length > 0,
        attachment_count: processedAttachments.length,
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
      selectedModel,
      chatMessages.length,
    ]
  )

  // Consume the initial message handed off from the home screen via the
  // in-memory useInitialMessage store (avoids sessionStorage size limits for
  // attachments).
  const initialMessageSentRef = useRef(false)

  useEffect(() => {
    // #region agent log
    ttftPreBegin('threadDetail-mount-or-effect', {
      threadId,
      hasInitialMessage:
        useInitialMessage.getState().byThread[threadId] !== undefined,
      alreadySent: initialMessageSentRef.current,
    })
    // #endregion
    if (initialMessageSentRef.current) return

    const message = useInitialMessage.getState().consume(threadId)
    if (!message) return

    // #region agent log
    ttftPreBegin('consume-initial-message', { threadId })
    // #endregion
    initialMessageSentRef.current = true
    ;(async () => {
      try {
        await processAndSendMessage(
          message.text,
          message.files,
          message.documents
        )
      } catch (error) {
        console.error('[ThreadPage] Failed to process initial message:', error)
      }
    })()
  }, [threadId, processAndSendMessage])

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

    const currentCtxLen =
      (model.settings?.ctx_len?.controller_props?.value as number) ?? 8192

    /// Ask the owning local-provider engine for the model's training-max
    /// context. Duck-typed so non-local providers (or extensions that
    /// haven't been updated yet) gracefully fall back to the open-ended
    /// ladder instead of crashing. The shared `computeNextCtxLen` ladder
    /// then clamps the next step so we never push past what the model's
    /// positional embeddings actually support.
    let maxCtxLen: number | undefined
    try {
      const engine = EngineManager.instance().get(selectedProvider) as
        | (AIEngine & { getMaxCtxTrain?: (id: string) => Promise<number | undefined> })
        | undefined
      if (engine && typeof engine.getMaxCtxTrain === 'function') {
        maxCtxLen = await engine.getMaxCtxTrain(selectedModel.id)
      }
    } catch (e) {
      console.warn(
        `[auto-expand-ctx] getMaxCtxTrain failed for ${selectedProvider}/${selectedModel.id}:`,
        e
      )
    }

    const newCtxLen = computeNextCtxLen(currentCtxLen, maxCtxLen)
    if (newCtxLen <= currentCtxLen) {
      toast.error('Model reached its maximum context, auto-expand stopped', {
        id: `ctx-at-max-${selectedProvider}-${selectedModel.id}`,
      })
      return
    }

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

  // Keep refs in sync so onFinish always calls the latest versions
  handleContextSizeIncreaseRef.current = handleContextSizeIncrease
  setContinueFromContentRef.current = setContinueFromContent

  // Skip auto-context-increase in agent mode
  const agentModeActive = useAgentMode((s) => s.agentThreads[threadId] === true)
  useEffect(() => {
    if (!error || agentModeActive) return
    const autoIncrease =
      selectedModel?.settings?.auto_increase_ctx_len?.controller_props?.value ??
      true
    if (!autoIncrease) return
    if (isContextLimitError(error)) {
      setIsAutoIncreasingContext(true)
      handleContextSizeIncrease()
    }
  }, [error]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // #region agent log
    ttftPreBegin('chat-status-change', { threadId, status })
    // #endregion
    if (status === 'streaming' || status === 'submitted') {
      setContextLimitError(null)
    }
    if (
      isAutoIncreasingContext &&
      (status === 'streaming' || status === 'error')
    ) {
      setIsAutoIncreasingContext(false)
    }
    if (status === 'error' && pendingContinueMessage) {
      setPendingContinueMessage(null)
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const threadModel = useMemo(
    () => searchThreadModel ?? thread?.model,
    [searchThreadModel, thread]
  )

  return (
    <div className="flex h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))] overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
          <DropdownModelProvider />
        </div>
      </HeaderPage>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col h-full overflow-hidden min-w-0">
        {/* Messages Area */}
        <div className="flex-1 relative">
          <Conversation className="absolute inset-0 text-start">
            <ConversationContent
              className={cn('mx-auto w-full md:w-4/5 xl:w-4/6')}
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
                    isAnimating={!pendingContinueMessage}
                    hideActions={!!pendingContinueMessage}
                  />
                )
              })}
              {pendingInitialUserMessage && (
                <>
                  <MessageItem
                    key={`pending-user-${pendingInitialUserMessage.id}`}
                    message={pendingInitialUserMessage}
                    isFirstMessage={chatMessages.length === 0}
                    isLastMessage={true}
                    status={status}
                    reasoningContainerRef={reasoningContainerRef}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    hideActions
                    isAnimating={false}
                  />
                  <div className="flex flex-row items-center gap-2 mt-2">
                    <Shimmer duration={1}>Indexing attachments...</Shimmer>
                  </div>
                </>
              )}
              {pendingContinueMessage && status === 'submitted' && (
                <MessageItem
                  key={`continue-placeholder-${pendingContinueMessage.id}`}
                  message={pendingContinueMessage}
                  isFirstMessage={false}
                  isLastMessage={true}
                  status={status}
                  reasoningContainerRef={reasoningContainerRef}
                  onRegenerate={handleRegenerate}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  hideActions
                  isAnimating={false}
                />
              )}
              {(status === CHAT_STATUS.SUBMITTED ||
                isAutoIncreasingContext) && (
                <div className="flex flex-row items-center gap-2">
                  {(pendingContinueMessage || isAutoIncreasingContext) && (
                    <Shimmer duration={1}>Growing the Mind...</Shimmer>
                  )}
                  {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
                </div>
              )}
              {(error || contextLimitError) &&
                !isAutoIncreasingContext &&
                (() => {
                  const activeError = error ?? contextLimitError
                  const rawMessage = activeError?.message
                  const isContextError = isContextLimitError(activeError)
                  const isAccessError =
                    !isContextError && isModelAccessError(activeError)
                  // ATO-197: a fatal Metal/compute failure (GPU OOM) surfaces
                  // as the opaque "Compute error" / the proxy's
                  // `insufficient_memory` envelope — show clear OOM guidance.
                  const isOomError =
                    !isContextError &&
                    !isAccessError &&
                    isOutOfMemoryError(activeError)
                  // ATO-170: replace the raw engine 400 body (e.g. mlx-vlm's
                  // "... but MAX_KV_SIZE is N") with a clear, actionable message
                  // instead of the generic "Error generating response".
                  const title = isContextError
                    ? CONTEXT_OVERFLOW_TITLE
                    : isAccessError
                      ? MODEL_ACCESS_DENIED_TITLE
                      : isOomError
                        ? OUT_OF_MEMORY_TITLE
                        : 'Error generating response'
                  const body = isContextError
                    ? CONTEXT_OVERFLOW_MESSAGE
                    : isAccessError
                      ? MODEL_ACCESS_DENIED_MESSAGE
                      : isOomError
                        ? OUT_OF_MEMORY_MESSAGE
                        : rawMessage
                  return (
                    <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
                      <div className="flex items-start gap-3">
                        <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-destructive mb-1">
                            {title}
                          </p>
                          <div className="table table-fixed w-full">
                            <span
                              className="text-sm text-muted-foreground table-cell align-middle"
                              style={{ wordWrap: 'break-word' }}
                            >
                              {/* The raw provider message can embed links
                                  (e.g. the model-policy banner's "Open
                                  dashboard" / "View agreement"); render them
                                  clickable instead of as dead text. */}
                              <LinkifiedText text={body ?? ''} />
                            </span>
                          </div>
                          {isContextError ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={handleContextSizeIncrease}
                            >
                              <IconAlertCircle className="size-4 mr-2" />
                              Increase Context Size
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => handleRegenerate()}
                            >
                              <IconRefresh className="size-4 mr-2" />
                              Retry
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        {/* Chat Input - Fixed at bottom */}
        <div className="py-4 mx-auto w-full md:w-4/5 xl:w-4/6">
          <ChatInput
            model={threadModel}
            onSubmit={handleSubmit}
            onStop={stop}
            chatStatus={status}
          />
        </div>
        </div>
      </div>
      </div>
      <ArtifactPanel />
    </div>
  )
}

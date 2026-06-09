import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useParams, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import HeaderPage from '@/containers/HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useMessageErrors } from '@/stores/message-errors'
import { useServiceHub } from '@/hooks/useServiceHub'
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
import { invoke } from '@tauri-apps/api/core'
import { generateId, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
  uiMessageHasMeaningfulContent,
  threadMessageIsEmpty,
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
import { OUT_OF_CONTEXT_SIZE, isContextOverflowMessage } from '@/utils/error'
import { Button } from '@/components/ui/button'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { useToolApproval } from '@/hooks/useToolApproval'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useMessageQueue } from '@/stores/message-queue-store'
import { generateThreadTitle } from '@/lib/thread-title-summarizer'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { WorkspacePanelsLayout } from '@/containers/ModelToolsPanel'

import {
  isCodexAppServerProvider,
  steerCodexSubThreadEvents,
} from '@/lib/codex-app-server'
import { CodexActivityPart } from '@/components/ai-elements/codex-activity'
import { toast } from 'sonner'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const TITLE_REFRESH_EVERY_N_ASSISTANT_MESSAGES = 4

// Persist the out-of-context error onto the latest user message so the banner
// survives thread switches, mirroring how LlamacppOomListener stamps oom/backend.
function stampContextErrorOnThread(threadId: string) {
  const messages = useMessages.getState().getMessages(threadId)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const meta = (m.metadata as Record<string, unknown> | undefined) ?? {}
    if (meta.contextError === OUT_OF_CONTEXT_SIZE) return
    useMessages.getState().updateMessage({
      ...m,
      metadata: { ...meta, contextError: OUT_OF_CONTEXT_SIZE },
    })
    return
  }
}

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

  const titleAbortRef = useRef<AbortController | null>(null)

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
  const [contextLimitError, setContextLimitError] = useState<Error | null>(null)
  const [processingEmbeddings, setProcessingEmbeddings] = useState(false)

  // Refs so onFinish (captured in closure) always calls the latest callbacks
  const oomErrorRaw = useAppState((s) => s.oomError)
  const setOomError = useAppState((s) => s.setOomError)
  const backendErrorRaw = useAppState((s) => s.backendError)
  const setBackendError = useAppState((s) => s.setBackendError)

  // These signals come from the llamacpp router via global Tauri events.
  // Mask them when the active provider isn't llamacpp so a router crash
  // doesn't decorate chats running against MLX / OpenAI / Anthropic / etc.
  const isLlamacppActive = selectedProvider === 'llamacpp'
  const oomError = isLlamacppActive ? oomErrorRaw : undefined
  const backendError = isLlamacppActive ? backendErrorRaw : undefined

  const handleContextSizeIncreaseRef = useRef<(() => void) | null>(null)
  const setContinueFromContentRef = useRef<((content: string) => void) | null>(
    null
  )
  // Holds the partial assistant output captured when the model stops with
  // `finishReason === 'length'`. Consumed by `handleContextSizeIncrease` so
  // the manual "Increase Context Size" button resumes from where the stream
  // stopped rather than regenerating from scratch.
  const pendingContinuationRef = useRef<{
    message: UIMessage
    text: string
  } | null>(null)

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
    experimental_throttle: 50,
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
          // Stash the partial so the manual "Increase Context Size" button can
          // resume from here. Surface the standard banner with the manual
          // button — auto-increase was removed; the user explicitly opts in.
          const partialText = message.parts
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('')
          if (partialText) {
            pendingContinuationRef.current = { message, text: partialText }
          }
          stampContextErrorOnThread(threadId)
          setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
        }
        return
      }

      if (!isAbort && message.parts.length) setPendingContinueMessage(null)

      // Persist assistant message to backend (skip if aborted).
      // For continuations, message.parts already contains partial + new content
      // because the stream wrapper prepended the partial text as the first delta.
      if (
        !isAbort &&
        message.role === 'assistant' &&
        uiMessageHasMeaningfulContent(message)
      ) {
        const contentParts = extractContentPartsFromUIMessage(message)
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

        const existingMessages = useMessages.getState().getMessages(threadId)
        const existingMessage = existingMessages.find(
          (m) => m.id === message.id
        )

        if (existingMessage) {
          updateMessage(assistantMessage)
        } else {
          addMessage(assistantMessage)
        }

        for (const m of existingMessages) {
          const meta = m.metadata as Record<string, unknown> | undefined
          if (meta?.error) {
            const rest = { ...meta }
            delete rest.error
            updateMessage({ ...m, metadata: rest })
          }
          useMessageErrors.getState().clearError(m.id)
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

            // Built-in RAG tools are internal and should not require approval.
            const approved = ragToolNames.has(toolName)
              ? true
              : await useToolApproval
                  .getState()
                  .requestApproval(toolCall.toolCallId, toolName, threadId)

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

      if (!isAbort) {
        const localMessages = useMessages.getState().getMessages(threadId)
        const assistantCount = localMessages.filter(
          (m) => m.role === 'assistant'
        ).length
        const isRefreshTick =
          assistantCount === 1 ||
          (assistantCount > 0 &&
            assistantCount % TITLE_REFRESH_EVERY_N_ASSISTANT_MESSAGES === 0)
        if (isRefreshTick) {
          const TITLE_TRANSCRIPT_MAX_TURNS = 8
          const recent = localMessages.slice(-TITLE_TRANSCRIPT_MAX_TURNS)
          const inputText =
            recent
              .map((m) => {
                const text = m.content
                  ?.map((c) => c?.text?.value ?? '')
                  .join('')
                  .trim()
                if (!text) return ''
                const role = m.role === 'assistant' ? 'Assistant' : 'User'
                return `${role}: ${text}`
              })
              .filter(Boolean)
              .join('\n\n') || useThreads.getState().threads[threadId]?.title
          if (inputText) {
            const provider = useModelProvider.getState().selectedProvider
            const modelId = useModelProvider.getState().selectedModel?.id
            ;(async () => {
              if (provider === 'llamacpp' && modelId) {
                let idle = false
                for (let attempt = 0; attempt < 6; attempt++) {
                  try {
                    idle = await invoke<boolean>(
                      'plugin:llamacpp|router_slots_idle',
                      { modelId }
                    )
                  } catch {
                    idle = true
                    break
                  }
                  if (idle) break
                  await new Promise((r) => setTimeout(r, 150))
                }
                if (!idle) return
              }
              titleAbortRef.current?.abort()
              const controller = new AbortController()
              titleAbortRef.current = controller
              const title = await generateThreadTitle(
                inputText,
                controller.signal
              )
              if (!title || controller.signal.aborted) return
              useThreads.getState().updateThread(threadId, { title })
              titleAbortRef.current = null
            })()
          }
        }
      }
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

  // Auto-scroll the reasoning container during streaming, pausing when the user scrolls up
  const {
    containerRef: reasoningContainerRef,
    isAtBottom: isReasoningAtBottom,
    handleScroll: handleReasoningScroll,
    scrollToBottom: scrollReasoningToBottom,
    forceScrollToBottom: forceScrollReasoningToBottom,
    reset: resetReasoningScroll,
  } = useAutoScroll()

  const lastIsAssistant = useMemo(() => {
    const last = chatMessages[chatMessages.length - 1]
    return !!last && last.role === 'assistant'
  }, [chatMessages])

  useEffect(() => {
    if (status === 'streaming') {
      resetReasoningScroll()
    }
  }, [status, resetReasoningScroll])

  useEffect(() => {
    if (status === 'streaming') {
      scrollReasoningToBottom()
    }
  }, [status, chatMessages, scrollReasoningToBottom])

  useEffect(() => {
    setCurrentThreadId(threadId)
    titleAbortRef.current?.abort()
    titleAbortRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

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

          // Drop and delete any persisted empty assistant rows produced by
          // the old bug where errored generations were written as empty-text
          // messages. Lossless cleanup — these carry no information.
          const emptyAssistantIds = messagesToSet
            .filter(threadMessageIsEmpty)
            .map((m) => m.id)
          if (emptyAssistantIds.length > 0) {
            messagesToSet = messagesToSet.filter(
              (m) => !emptyAssistantIds.includes(m.id)
            )
            for (const id of emptyAssistantIds) {
              deleteMessage(threadId, id)
            }
          }

          setMessages(threadId, messagesToSet)

          const hydrated: Record<string, string> = {}
          for (const m of messagesToSet) {
            const err = (m.metadata as Record<string, unknown> | undefined)
              ?.error
            if (typeof err === 'string' && err.length > 0) {
              hydrated[m.id] = err
            }
          }
          useMessageErrors.getState().hydrate(hydrated)

          const uiMessages = convertThreadMessagesToUIMessages(messagesToSet)
          setChatMessages(uiMessages)
          currentThread.current = threadId
        }
      })
      .catch((error) =>
        console.error('Failed to fetch messages for thread:', threadId, error)
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serviceHub])

  useEffect(() => {
    return () => {
      titleAbortRef.current?.abort()
      setCurrentThreadId(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resync the OOM/backend banner from message metadata on every thread switch.
  // Persisted by LlamacppOomListener at error time; unset state when this
  // thread carries no such metadata so the banner doesn't leak across threads.
  const threadMessagesForBanner = useMessages((s) => s.messages?.[threadId])
  useEffect(() => {
    let oom: string | undefined
    let be: string | undefined
    let ctx: string | undefined
    for (const m of threadMessagesForBanner ?? []) {
      const meta = m.metadata as Record<string, unknown> | undefined
      const o = meta?.oomError
      if (typeof o === 'string' && o.length > 0) oom = o
      const b = meta?.backendError
      if (typeof b === 'string' && b.length > 0) be = b
      const c = meta?.contextError
      if (typeof c === 'string' && c.length > 0) ctx = c
    }
    useAppState.getState().setOomError(oom)
    useAppState.getState().setBackendError(be)
    setContextLimitError(ctx ? new Error(ctx) : null)
  }, [threadId, threadMessagesForBanner])

  // Consolidated function to process and send a message
  const processAndSendMessage = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      // Cancel any in-flight title summarization so it doesn't compete with this request
      titleAbortRef.current?.abort()
      titleAbortRef.current = null

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
        ...allAttachments.filter(
          (a) =>
            a.type === 'document' ||
            a.type === 'browser-selection' ||
            a.type === 'terminal-output' ||
            a.type === 'runtime-log' ||
            a.type === 'process-list' ||
            a.type === 'context-brief'
        ),
      ]

      const messageId = generateId()
      const hasDocuments = combinedAttachments.some(
        (a) => a.type === 'document' && !a.processed
      )
      const hasEmbeddingDocuments = combinedAttachments.some(
        (a) => a.type === 'document' && !a.processed && a.parseMode !== 'inline'
      )

      // When there are unprocessed documents (e.g. first-message flow),
      // show the user message in the conversation immediately so the UI
      // doesn't hang while embeddings are generated.
      if (hasDocuments) {
        const previewMessage = newUserThreadContent(
          threadId,
          text,
          combinedAttachments,
          messageId
        )
        const previewUI = convertThreadMessagesToUIMessages([previewMessage])
        setChatMessages((prev) => [...prev, ...previewUI])
      }

      // Clear attachment chips from the input — they are now either
      // about to be sent or visible in the preview message above.
      clearAttachmentsForThread(attachmentsKey)

      // Process attachments (ingest images, parse/index documents)
      let processedAttachments = combinedAttachments
      const projectId = thread?.metadata?.project?.id
      if (combinedAttachments.length > 0) {
        if (hasEmbeddingDocuments) {
          setProcessingEmbeddings(true)
          useAppState.getState().setThreadBusy(threadId, true)
        }
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
            const toolApproval = useToolApproval.getState()
            const ragTools = useAppState.getState().ragToolNames
            for (const toolName of ragTools) {
              toolApproval.approveToolForThread(threadId, toolName)
            }
            useThreads.getState().updateThread(threadId, {
              metadata: { hasDocuments: true },
            })
          }
        } catch (error) {
          console.error('Failed to process attachments:', error)
          // Remove the preview message on failure
          if (hasDocuments) {
            setChatMessages((prev) => prev.filter((m) => m.id !== messageId))
          }
          return
        } finally {
          setProcessingEmbeddings(false)
          useAppState.getState().setThreadBusy(threadId, false)
        }
      }

      // Remove the preview before sendMessage adds the real user message
      // with the same id — this prevents duplicates.
      if (hasDocuments) {
        setChatMessages((prev) => prev.filter((m) => m.id !== messageId))
      }

      // Persist the final message to backend
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
        metadata: { ...userMessage.metadata, createdAt: new Date() },
      })
    },
    [
      sendMessage,
      threadId,
      thread,
      addMessage,
      getAttachments,
      attachmentsKey,
      setChatMessages,
      clearAttachmentsForThread,
      serviceHub,
      selectedProvider,
    ]
  )

  // Sends a text-only queued message, bypassing attachment processing entirely.
  // This prevents stale or new attachments from leaking into auto-sent queue items.
  const sendQueuedMessage = useCallback(
    async (text: string) => {
      const messageId = generateId()
      const userMessage = newUserThreadContent(threadId, text, [], messageId)
      addMessage(userMessage)

      sendMessage({
        parts: [{ type: 'text', text }],
        id: messageId,
        metadata: userMessage.metadata,
      })
    },
    [sendMessage, threadId, addMessage]
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

  const stripBannerMetadata = useCallback(() => {
    const tmsgs = useMessages.getState().getMessages(threadId)
    for (const m of tmsgs) {
      const meta = m.metadata as Record<string, unknown> | undefined
      if (!meta) continue
      if (
        meta.oomError == null &&
        meta.backendError == null &&
        meta.contextError == null
      )
        continue
      const nextMeta = { ...meta }
      delete nextMeta.oomError
      delete nextMeta.backendError
      delete nextMeta.contextError
      updateMessage({ ...m, metadata: nextMeta })
    }
  }, [threadId, updateMessage])

  // Handle submit from ChatInput
  const handleSubmit = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      if (oomError) setOomError(undefined)
      if (backendError) setBackendError(undefined)
      if (contextLimitError) setContextLimitError(null)
      if (oomError || backendError || contextLimitError) stripBannerMetadata()
      await processAndSendMessage(text, files)
    },
    [
      processAndSendMessage,
      oomError,
      setOomError,
      backendError,
      setBackendError,
      contextLimitError,
      stripBannerMetadata,
    ]
  )

  // Handle regenerate from any message (user or assistant)
  // - For user messages: keeps the user message, deletes all after, regenerates assistant response
  // - For assistant messages: finds the closest preceding user message, deletes from there
  const handleRegenerate = useCallback(
    (messageId?: string) => {
      const hadBannerError =
        useAppState.getState().oomError != null ||
        useAppState.getState().backendError != null ||
        contextLimitError != null
      if (useAppState.getState().oomError) {
        useAppState.getState().setOomError(undefined)
      }
      if (useAppState.getState().backendError) {
        useAppState.getState().setBackendError(undefined)
      }
      if (contextLimitError) setContextLimitError(null)
      if (hadBannerError) stripBannerMetadata()
      // Cancel any in-flight title summarization before regenerating
      titleAbortRef.current?.abort()
      titleAbortRef.current = null

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
          const messagesToDelete = currentLocalMessages.slice(
            deleteFromIndex + 1
          )

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
    },
    [
      threadId,
      deleteMessage,
      regenerate,
      stripBannerMetadata,
      contextLimitError,
    ]
  )

  // Handle edit message - updates the message and regenerates from it
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const currentLocalMessages = useMessages.getState().getMessages(threadId)
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex === -1) return

      const originalMessage = currentLocalMessages[messageIndex]

      const priorMeta = (originalMessage.metadata || {}) as Record<
        string,
        unknown
      >
      const cleanedMeta = { ...priorMeta }
      delete cleanedMeta.error
      const updatedMessage = {
        ...originalMessage,
        content: [
          {
            type: ContentType.Text,
            text: { value: newText, annotations: [] },
          },
        ],
        metadata: cleanedMeta,
      }
      updateMessage(updatedMessage)
      useMessageErrors.getState().clearError(messageId)

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
      useMessageErrors.getState().clearError(messageId)

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

    // Increase context length in steps: <8192 -> 8192 -> 32768 -> x1.5
    const currentCtxLen =
      (model.settings?.ctx_len?.controller_props?.value as number) ?? 8192
    const maxCtxLen =
      (model.settings?.ctx_len?.controller_props?.max as number) || 131072

    let newCtxLen: number
    if (currentCtxLen < 8192) {
      newCtxLen = 8192
    } else if (currentCtxLen < 32768) {
      newCtxLen = 32768
    } else {
      newCtxLen = Math.round(currentCtxLen * 1.5)
    }

    newCtxLen = Math.min(newCtxLen, maxCtxLen)
    if (newCtxLen <= currentCtxLen) {
      stampContextErrorOnThread(threadId)
      setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
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

    // For llamacpp the router reads ctx-size from the preset, not from any
    // request param — so we must write model.yml and bounce the router before
    // the regenerate, otherwise the next load picks up the OLD context size.
    // Other providers consume the new Zustand value directly on next load.
    if (provider.provider === 'llamacpp') {
      try {
        await serviceHub
          .models()
          .updateModelSettings(selectedModel.id, { ctx_len: newCtxLen })
      } catch (e) {
        updateProvider(provider.provider, {
          models: provider.models,
        })
        console.error('Failed to persist increased ctx_len', e)
        stampContextErrorOnThread(threadId)
        setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
        return
      }
    } else {
      await serviceHub.models().stopModel(selectedModel.id)
    }

    // Consume any pending partial captured at the `finishReason === 'length'`
    // event so the regenerate resumes from where the stream stopped, and the
    // "Growing the Mind…" shimmer renders while the model reloads.
    const pending = pendingContinuationRef.current
    pendingContinuationRef.current = null
    if (pending) {
      setContinueFromContentRef.current?.(pending.text)
      setPendingContinueMessage(pending.message)
    }

    setTimeout(() => {
      handleRegenerate()
    }, 1000)
  }, [
    selectedModel,
    selectedProvider,
    getProviderByName,
    serviceHub,
    handleRegenerate,
    threadId,
  ])

  // Keep refs in sync so onFinish always calls the latest versions
  handleContextSizeIncreaseRef.current = handleContextSizeIncrease
  setContinueFromContentRef.current = setContinueFromContent

  useEffect(() => {
    if (
      (oomError || backendError || contextLimitError) &&
      (status === 'streaming' || status === 'submitted')
    ) {
      try {
        stop()
      } catch (e) {
        console.warn('router error stop() threw:', e)
      }
    }
  }, [oomError, backendError, contextLimitError, status, stop])

  useEffect(() => {
    if (status === 'streaming' && pendingContinuationRef.current) {
      // The new turn is now flowing; drop the saved partial so it can't be
      // consumed by a later, unrelated "Increase Context Size" click.
      pendingContinuationRef.current = null
    }
    if (status === 'error' && pendingContinueMessage) {
      setPendingContinueMessage(null)
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Message queue: auto-send the next queued message when the stream finishes.
  // No reactive subscription to the queue here — ChatInput owns the UI.
  // We only read the store imperatively when status transitions to 'ready'.
  const processingQueueRef = useRef(false)

  useEffect(() => {
    if (status !== 'ready' || processingQueueRef.current) return
    if (sessionData.tools.length > 0) return

    const next = useMessageQueue.getState().dequeue(threadId)
    if (!next) return

    processingQueueRef.current = true
    sendQueuedMessage(next.text)
      .catch((err) => {
        console.error('Failed to send queued message:', err)
      })
      .finally(() => {
        processingQueueRef.current = false
      })
  }, [status, threadId, sendQueuedMessage, sessionData.tools.length])

  // If streaming errors out, discard any queued messages so they don't sit there stuck
  useEffect(() => {
    if (status === 'error') {
      useMessageQueue.getState().clearQueue(threadId)
    }
  }, [status, threadId])

  // Attach the error to the assistant turn it belongs to so the banner renders
  // alongside any tool-call parts the model already produced. Falls back to the
  // last user message if no assistant message exists yet (e.g. provider 4xx
  // before streaming starts).
  useEffect(() => {
    if (!error) return
    let targetId: string | undefined
    let lastUserIdx = -1
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    for (let i = chatMessages.length - 1; i > lastUserIdx; i--) {
      if (chatMessages[i].role === 'assistant') {
        targetId = chatMessages[i].id
        break
      }
    }
    if (!targetId && lastUserIdx >= 0) {
      targetId = chatMessages[lastUserIdx].id
    }
    if (!targetId) return
    const errMessage =
      error instanceof Error ? error.message : String(error || 'Error')
    // Context overflow is owned by the global "Increase Context Size" banner;
    // a per-message Regenerate would just re-overflow the same prompt.
    if (isContextOverflowMessage(errMessage)) {
      stampContextErrorOnThread(threadId)
      setContextLimitError(new Error(OUT_OF_CONTEXT_SIZE))
      useMessageErrors.getState().clearError(targetId)
      return
    }
    useMessageErrors.getState().setError(targetId, errMessage)
    const tm = useMessages
      .getState()
      .getMessages(threadId)
      .find((m) => m.id === targetId)
    if (tm) {
      const existingError = (tm.metadata as Record<string, unknown> | undefined)
        ?.error
      if (existingError !== errMessage) {
        updateMessage({
          ...tm,
          metadata: { ...(tm.metadata || {}), error: errMessage },
        })
      }
    }
  }, [status, error, threadId, chatMessages, updateMessage])

  // Persist whenever the user message lands in useMessages — covers the race
  // where the stamping effect ran before addMessage's commit was observable.
  const localThreadMessages = useMessages((s) => s.messages?.[threadId])
  const errorEntries = useMessageErrors((s) => s.errors)
  useEffect(() => {
    if (!localThreadMessages) return
    for (const m of localThreadMessages) {
      const err = errorEntries[m.id]
      if (typeof err !== 'string' || !err) continue
      const existing = (m.metadata as Record<string, unknown> | undefined)
        ?.error
      if (existing === err) continue
      updateMessage({
        ...m,
        metadata: { ...(m.metadata || {}), error: err },
      })
    }
  }, [localThreadMessages, errorEntries, updateMessage])

  // Clear the queue when navigating away from this thread
  useEffect(() => {
    return () => {
      useMessageQueue.getState().clearQueue(threadId)
    }
  }, [threadId])

  const threadModel = useMemo(
    () => searchThreadModel ?? thread?.model,
    [searchThreadModel, thread]
  )
  const panelScope = useMemo(() => {
    const label = thread?.title ?? 'Chat'
    return {
      type: 'chat' as const,
      id: threadId,
      label,
      sessionId: threadId,
      threadId,
    }
  }, [thread?.title, threadId])
  const selectedProviderForCodex = useModelProvider((s) => s.selectedProvider)
  const isCodex = isCodexAppServerProvider(selectedProviderForCodex)

  const [inspectSubThreadId, setInspectSubThreadId] = useState<string | null>(
    null
  )
  const [liveSubagentEvents, setLiveSubagentEvents] = useState<
    Record<string, unknown[]>
  >({})
  const [steeringSubThreadId, setSteeringSubThreadId] = useState<string | null>(
    null
  )

  // Derive running/seen subagents from streamed codex events (threadIds different from primary)
  const subagents = useMemo(() => {
    type CodexEventPartData = { threadId?: string; type?: string }
    const primaryThreadId = (() => {
      for (const m of chatMessages) {
        const meta = (m.metadata as any) || {}
        if (meta.codex?.threadId) return meta.codex.threadId
        for (const p of m.parts || []) {
          const data = (p as { data?: CodexEventPartData }).data
          if (p.type === 'data-codex-event' && data?.threadId) {
            // first seen is likely primary
            return data.threadId
          }
        }
      }
      return null
    })()

    const subs = new Map<
      string,
      {
        threadId: string
        status: string
        lastActivity: string
        eventCount: number
      }
    >()

    for (const m of chatMessages) {
      for (const p of m.parts || []) {
        if (p.type !== 'data-codex-event') continue
        const data = (p as { data?: CodexEventPartData }).data || {}
        const tid = data.threadId
        if (!tid || tid === primaryThreadId) continue

        if (!subs.has(tid)) {
          subs.set(tid, {
            threadId: tid,
            status: 'running',
            lastActivity: data.type || 'activity',
            eventCount: 0,
          })
        }
        const entry = subs.get(tid)!
        entry.eventCount += 1
        entry.lastActivity = data.type || entry.lastActivity
        if (data.type === 'turn_completed' || data.type === 'item_completed') {
          entry.status = 'completed'
        } else if (
          data.type &&
          !['item_completed', 'turn_completed'].includes(data.type)
        ) {
          entry.status = 'running'
        }
      }
    }
    return Array.from(subs.values()).sort((a, b) =>
      a.threadId.localeCompare(b.threadId)
    )
  }, [chatMessages])

  const subagentEvents = useMemo(() => {
    if (!inspectSubThreadId) return []
    const events: Array<{ messageId: string; partIndex: number; data: unknown }> =
      []
    for (const message of chatMessages) {
      message.parts?.forEach((part, partIndex) => {
        if (part.type !== 'data-codex-event') return
        const data = (part as { data?: { threadId?: string } }).data
        if (data?.threadId === inspectSubThreadId) {
          events.push({ messageId: message.id, partIndex, data })
        }
      })
    }
    const live = liveSubagentEvents[inspectSubThreadId] ?? []
    for (let i = 0; i < live.length; i++) {
      events.push({
        messageId: `live-steer-${inspectSubThreadId}`,
        partIndex: i,
        data: live[i],
      })
    }
    return events
  }, [chatMessages, inspectSubThreadId, liveSubagentEvents])

  return (
    <WorkspacePanelsLayout scope={panelScope}>
      <div className="flex h-full min-h-0 flex-col">
        <HeaderPage />
        <div className="flex min-h-0 flex-1 flex-col h-full overflow-hidden">
          {/* Messages Area */}
          <div className="flex-1 relative">
            <Conversation className="absolute inset-0 text-start">
              <ConversationContent
                className={cn('mx-auto w-full md:w-4/5 xl:w-4/6')}
              >
                {/* Subagent visibility and inspector for Codex engine.
                   - Live tabs/list of running subagents (from Codex events with their own threadIds).
                   - Click tab to open/inspect exactly what that subagent is doing (its plans, commands+outputs, file changes, etc.).
                   - Steering form: send follow-up instructions directly to a chosen subagent (turn/steer on its threadId).
                   - Like the Codex TUI /agent switcher + direct interaction with children.
                */}
                {isCodex && subagents.length > 0 && (
                  <div className="mb-3 p-2 border rounded-md bg-muted/10 text-sm">
                    <div className="font-medium mb-1 flex items-center gap-2">
                      Subagents ({subagents.length})
                      <span className="text-xs text-muted-foreground">
                        (Codex engine — tabs to inspect/steer)
                      </span>
                    </div>

                    {/* Tab bar for subagents */}
                    <div className="flex flex-wrap gap-1 mb-2 border-b pb-1">
                      {subagents.map((sa) => (
                        <button
                          key={sa.threadId}
                          onClick={() => setInspectSubThreadId(sa.threadId)}
                          className={cn(
                            'text-xs px-3 py-1 rounded-t border-b-2 hover:bg-accent transition-colors',
                            inspectSubThreadId === sa.threadId
                              ? 'bg-background border-primary font-medium'
                              : 'border-transparent hover:border-muted-foreground',
                            sa.status === 'completed'
                              ? 'text-green-600'
                              : 'text-blue-600'
                          )}
                          title={`Inspect & steer subagent thread ${sa.threadId}`}
                        >
                          {sa.threadId.slice(0, 6)}… {sa.status} (
                          {sa.eventCount})
                        </button>
                      ))}
                      {inspectSubThreadId && (
                        <button
                          onClick={() => setInspectSubThreadId(null)}
                          className="text-xs px-2 py-1 rounded border ml-auto"
                        >
                          Close
                        </button>
                      )}
                    </div>

                    {/* Selected subagent inspector + steer */}
                    {inspectSubThreadId && (
                      <div className="mt-2 p-2 border-t text-xs bg-background rounded">
                        <div className="font-medium mb-2 flex items-center justify-between">
                          <span>Subagent {inspectSubThreadId}</span>
                          <span className="text-[10px] text-muted-foreground">
                            Live Codex activity
                          </span>
                        </div>

                        {/* Steering — talk directly to this opened subagent */}
                        <form
                          className="mb-3 flex gap-2"
                          onSubmit={async (e) => {
                            e.preventDefault()
                            const form = e.currentTarget as HTMLFormElement
                            const input = form.elements.namedItem(
                              'steerText'
                            ) as HTMLInputElement
                            const text = input.value.trim()
                            if (!text) return
                            setSteeringSubThreadId(inspectSubThreadId)
                            try {
                              for await (const event of steerCodexSubThreadEvents(
                                threadId,
                                inspectSubThreadId,
                                text
                              )) {
                                setLiveSubagentEvents((prev) => ({
                                  ...prev,
                                  [inspectSubThreadId]: [
                                    ...(prev[inspectSubThreadId] ?? []),
                                    event,
                                  ],
                                }))
                              }
                              input.value = ''
                              toast.success(
                                `Steered subagent ${inspectSubThreadId.slice(0, 8)}…`
                              )
                            } catch (err) {
                              const message =
                                err instanceof Error
                                  ? err.message
                                  : 'Steer subagent failed'
                              toast.error(message)
                            } finally {
                              setSteeringSubThreadId(null)
                            }
                          }}
                        >
                          <input
                            name="steerText"
                            className="flex-1 text-xs border rounded px-2 py-1 bg-transparent"
                            placeholder="Follow-up for this subagent (e.g. 'also check for race conditions')..."
                          />
                          <button
                            type="submit"
                            className="text-xs px-3 py-1 border rounded hover:bg-accent disabled:opacity-50"
                            disabled={steeringSubThreadId === inspectSubThreadId}
                          >
                            {steeringSubThreadId === inspectSubThreadId
                              ? 'Steering…'
                              : 'Steer'}
                          </button>
                        </form>

                        {/* Live + historical activity for this subagent (all streamed events) */}
                        {subagentEvents.length === 0 ? (
                          <div className="text-muted-foreground italic">
                            No activity yet for this subagent…
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {subagentEvents.map((event, i) => {
                              const parentMessage =
                                chatMessages.find(
                                  (m) => m.id === event.messageId
                                ) ?? chatMessages[chatMessages.length - 1]
                              return (
                                <CodexActivityPart
                                  key={`${event.messageId}-${event.partIndex}-${i}`}
                                  part={{
                                    type: 'data-codex-event',
                                    data: event.data,
                                  }}
                                  partIndex={event.partIndex}
                                  message={parentMessage as any}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {!inspectSubThreadId && (
                      <div className="text-[10px] text-muted-foreground">
                        Select a tab to open that subagent and see/steer its
                        work.
                      </div>
                    )}
                  </div>
                )}

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
                      isReasoningAtBottom={isReasoningAtBottom}
                      onReasoningScroll={handleReasoningScroll}
                      onReasoningScrollToBottom={forceScrollReasoningToBottom}
                      onRegenerate={handleRegenerate}
                      onEdit={handleEditMessage}
                      onDelete={handleDeleteMessage}
                      isAnimating={!pendingContinueMessage}
                      hideActions={!!pendingContinueMessage}
                    />
                  )
                })}
                {pendingContinueMessage && status === 'submitted' && (
                  <MessageItem
                    key={`continue-placeholder-${pendingContinueMessage.id}`}
                    message={pendingContinueMessage}
                    isFirstMessage={false}
                    isLastMessage={true}
                    status={status}
                    reasoningContainerRef={reasoningContainerRef}
                    isReasoningAtBottom={isReasoningAtBottom}
                    onReasoningScroll={handleReasoningScroll}
                    onReasoningScrollToBottom={forceScrollReasoningToBottom}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                    hideActions
                    isAnimating={false}
                  />
                )}
                {processingEmbeddings && (
                  <div className="flex flex-row items-center gap-2">
                    <Shimmer duration={1}>Processing embeddings...</Shimmer>
                  </div>
                )}
                {!oomError &&
                  !backendError &&
                  !contextLimitError &&
                  status === CHAT_STATUS.SUBMITTED && (
                    <div className="flex flex-row items-center gap-2">
                      {pendingContinueMessage && (
                        <Shimmer duration={1}>Growing the Mind...</Shimmer>
                      )}
                      {!pendingContinueMessage && !lastIsAssistant && (
                        <PromptProgress />
                      )}
                    </div>
                  )}
                {(contextLimitError || oomError || backendError) && (
                  <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
                    <div className="flex items-start gap-3">
                      <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-destructive mb-1">
                          {oomError
                            ? 'llama.cpp ran out of memory'
                            : backendError
                              ? 'GGML backend encountered an error'
                              : 'Model ran out of context size'}
                        </p>
                        <div className="table table-fixed w-full">
                          <span
                            className={
                              (oomError || backendError
                                ? 'text-xs font-mono'
                                : 'text-sm') +
                              ' text-muted-foreground table-cell align-middle'
                            }
                            style={{ wordWrap: 'break-word' }}
                          >
                            {oomError ??
                              backendError ??
                              contextLimitError?.message}
                          </span>
                        </div>
                        {oomError && (
                          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                            <li>Reduce context size (ctx-size)</li>
                            <li>Disable MTP (Multi-Token Prediction)</li>
                            <li>
                              Lower n-gpu-layers or switch to a CPU backend
                            </li>
                            <li>Use a smaller / more quantized model</li>
                          </ul>
                        )}
                        {((error ?? contextLimitError)?.message
                          ?.toLowerCase()
                          .includes('context') &&
                          ((error ?? contextLimitError)?.message
                            ?.toLowerCase()
                            .includes('size') ||
                            (error ?? contextLimitError)?.message
                              ?.toLowerCase()
                              .includes('length') ||
                            (error ?? contextLimitError)?.message
                              ?.toLowerCase()
                              .includes('limit'))) ||
                        (error ?? contextLimitError)?.message ===
                          OUT_OF_CONTEXT_SIZE ? (
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
                            {oomError || backendError ? 'Reload' : 'Regenerate'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
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
              chatStatus={
                oomError || backendError || contextLimitError ? 'ready' : status
              }
            />
          </div>
        </div>
      </div>
    </WorkspacePanelsLayout>
  )
}

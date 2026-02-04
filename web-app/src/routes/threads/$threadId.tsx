<<<<<<< HEAD
﻿import { useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useParams, redirect, useNavigate } from '@tanstack/react-router'
import cloneDeep from 'lodash.clonedeep'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
=======
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

import HeaderPage from '@/containers/HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
<<<<<<< HEAD
import { ThreadContent } from '@/containers/ThreadContent'
import { StreamingContent } from '@/containers/StreamingContent'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import DropdownAssistant from '@/containers/DropdownAssistant'
import { useAssistant } from '@/hooks/useAssistant'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { ContentType, ThreadMessage } from '@janhq/core'
import { useSmallScreen, useMobileScreen } from '@/hooks/useMediaQuery'
import { useTools } from '@/hooks/useTools'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import ScrollToBottom from '@/containers/ScrollToBottom'
import { PromptProgress } from '@/components/PromptProgress'
import { ThreadPadding } from '@/containers/ThreadPadding'
import { TEMPORARY_CHAT_ID, TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
import { IconInfoCircle } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const CONVERSATION_NOT_FOUND_EVENT = 'conversation-not-found'

const TemporaryChatIndicator = ({ t }: { t: (key: string) => string }) => {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-main-view-fg/5 text-main-view-fg/70 text-sm">
      <span>{t('common:temporaryChat')}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative z-20">
            <IconInfoCircle
              size={14}
              className="text-main-view-fg/50 hover:text-main-view-fg/70 transition-colors cursor-pointer"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="z-[9999]">
          <p>{t('common:temporaryChatTooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  beforeLoad: ({ params }) => {
    // Check if this is the temporary chat being accessed directly
    if (params.threadId === TEMPORARY_CHAT_ID) {
      // Check if we have the navigation flag in sessionStorage
      const hasNavigationFlag = sessionStorage.getItem('temp-chat-nav')

      if (!hasNavigationFlag) {
        // Direct access - redirect to home with query parameter
        throw redirect({
          to: '/',
          search: { [TEMPORARY_CHAT_QUERY_ID]: true },
          replace: true,
        })
      }

      // Clear the flag immediately after checking
      sessionStorage.removeItem('temp-chat-nav')
    }
  },
=======
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useAssistant } from '@/hooks/useAssistant'
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
import { IconAlertCircle } from '@tabler/icons-react'
import { useToolApproval } from '@/hooks/useToolApproval'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { ExtensionTypeEnum, VectorDBExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  component: ThreadDetail,
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
<<<<<<< HEAD
  const navigate = useNavigate()
  const { t } = useTranslation()
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)
<<<<<<< HEAD

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()
  const isMobile = useMobileScreen()
  useTools()

  const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  )

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
<<<<<<< HEAD
  const scrollContainerRef = useRef<HTMLDivElement>(null)


  // Listen for conversation not found events
  useEffect(() => {
    const handleConversationNotFound = (event: CustomEvent) => {
      const { threadId: notFoundThreadId } = event.detail
      if (notFoundThreadId === threadId) {
        // Skip error handling for temporary chat - it's expected to not exist on server
        if (threadId === TEMPORARY_CHAT_ID) {
          return
        }

        toast.error(t('common:conversationNotAvailable'), {
          description: t('common:conversationNotAvailableDescription')
        })
        navigate({ to: '/', replace: true })
      }
    }

    window.addEventListener(CONVERSATION_NOT_FOUND_EVENT, handleConversationNotFound as EventListener)
    return () => {
      window.removeEventListener(CONVERSATION_NOT_FOUND_EVENT, handleConversationNotFound as EventListener)
    }
  }, [threadId, navigate, t])
=======

  // Get model and provider for useChat
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const threadRef = useRef(thread)
  const projectId = threadRef.current?.metadata?.project?.id

  // Get system message from thread's assistant instructions (if thread has an assigned assistant)
  // Only use assistant instructions if the thread was created with one (e.g., via a project)
  const threadAssistant = !projectId && thread?.assistants?.[0]
  const systemMessage = threadAssistant?.instructions
    ? renderInstructions(threadAssistant.instructions)
    : undefined

  useEffect(() => {
    threadRef.current = thread
  }, [thread])

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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  useEffect(() => {
    setCurrentThreadId(threadId)
    const assistant = assistants.find(
      (assistant) => assistant.id === thread?.assistants?.[0]?.id
    )
    if (assistant) setCurrentAssistant(assistant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, assistants])

<<<<<<< HEAD
  useEffect(() => {
=======
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

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
<<<<<<< HEAD
        if (fetchedMessages) {
          const currentLocalMessages = useMessages.getState().getMessages(threadId)

          if (PlatformFeatures[PlatformFeature.FIRST_MESSAGE_PERSISTED_THREAD] &&
              fetchedMessages.length === 0 &&
              currentLocalMessages &&
              currentLocalMessages.length > 0
          ) {
            return
          }

          // Update the messages in the store
=======
        if (fetchedMessages && fetchedMessages.length > 0) {
          const currentLocalMessages = useMessages
            .getState()
            .getMessages(threadId)

          let messagesToSet = fetchedMessages

          // Merge with local-only messages if needed
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
<<<<<<< HEAD
              const mergedMessages = [...fetchedMessages, ...localOnlyMessages].sort(
                (a, b) => (a.created_at || 0) - (b.created_at || 0)
              )
              setMessages(threadId, mergedMessages)
              return
            }
          }

          setMessages(threadId, fetchedMessages)
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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

<<<<<<< HEAD
  const updateMessage = (
    item: ThreadMessage,
    message: string,
    imageUrls?: string[]
  ) => {
    const newMessages: ThreadMessage[] = messages.map((m) => {
      if (m.id === item.id) {
        const msg: ThreadMessage = cloneDeep(m)
        const newContent = [
          {
            type: ContentType.Text,
            text: {
              value: message,
              annotations: m.content[0].text?.annotations ?? [],
            },
          },
        ]
        // Add image content if imageUrls are provided
        if (imageUrls && imageUrls.length > 0) {
          imageUrls.forEach((url) => {
            newContent.push({
              type: 'image_url' as ContentType,
              image_url: {
                url: url,
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
          })
        }
        msg.content = newContent
        return msg
      }
      return m
    })
    setMessages(threadId, newMessages)
  }

  const threadModel = useMemo(() => thread?.model, [thread])

  if (!messages || !threadModel) return null
=======
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

  if (!threadModel) return null
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center justify-between w-full pr-2">
<<<<<<< HEAD
          <div>
            {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
              <DropdownAssistant />
            )}
          </div>
          <div className="flex-1 flex justify-center">
            {threadId === TEMPORARY_CHAT_ID && <TemporaryChatIndicator t={t} />}
          </div>
          <div></div>
        </div>
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-40px)]">
        <div
          ref={scrollContainerRef}
          className={cn(
            'flex flex-col h-full w-full overflow-auto pt-4 pb-3',
            // Mobile-first responsive padding
            isMobile ? 'px-3' : 'px-4'
          )}
        >
          <div
            className={cn(
              'mx-auto flex max-w-full flex-col grow',
              // Mobile-first width constraints
              // Mobile and small screens always use full width, otherwise compact chat uses constrained width
              isMobile || isSmallScreen || chatWidth !== 'compact'
                ? 'w-full'
                : 'w-full md:w-4/6'
            )}
          >
            {messages &&
              messages.map((item, index) => {
                // Only pass isLastMessage to the last message in the array
                const isLastMessage = index === messages.length - 1
                return (
                  <div
                    key={item.id}
                    data-test-id={`message-${item.role}-${item.id}`}
                    data-message-author-role={item.role}
                    className="mb-4"
                  >
                    <ThreadContent
                      {...item}
                      isLastMessage={isLastMessage}
                      showAssistant={
                        item.role === 'assistant' &&
                        (index === 0 ||
                          messages[index - 1]?.role !== 'assistant' ||
                          !(
                            messages[index - 1]?.metadata &&
                            'tool_calls' in (messages[index - 1].metadata ?? {})
                          ))
                      }
                      index={index}
                      updateMessage={updateMessage}
                    />
                  </div>
                )
              })}
            <PromptProgress />
            <StreamingContent
              threadId={threadId}
              data-test-id="thread-content-text"
            />
            {/* Persistent padding element for ChatGPT-style message positioning */}
           <ThreadPadding threadId={threadId} scrollContainerRef={scrollContainerRef} />
          </div>
        </div>
        <div
          className={cn(
            'mx-auto pt-2 pb-3 shrink-0 relative',
            // Responsive padding and width
            isMobile ? 'px-3' : 'px-2',
            // Width: mobile/small screens or non-compact always full, compact desktop uses constrained
            isMobile || isSmallScreen || chatWidth !== 'compact'
              ? 'w-full'
              : 'w-full md:w-4/6'
          )}
        >
          <ScrollToBottom
            threadId={threadId}
            scrollContainerRef={scrollContainerRef}
          />
          <ChatInput model={threadModel} />
=======
          <DropdownModelProvider model={threadModel} />
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col h-full overflow-hidden">
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
                  />
                )
              })}
              {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
              {error && (
                <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
                  <div className="flex items-start gap-3">
                    <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive mb-1">
                        Error generating response
                      </p>
                      <p className="text-sm text-muted-foreground">
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
        <div className="py-4 mx-auto w-full md:w-4/5 xl:w-4/6">
          <ChatInput
            model={threadModel}
            onSubmit={handleSubmit}
            onStop={stop}
            chatStatus={status}
          />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        </div>
      </div>
    </div>
  )
}

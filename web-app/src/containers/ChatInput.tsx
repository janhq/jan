<<<<<<< HEAD
'use client'

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
<<<<<<< HEAD
  TooltipProvider,
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
<<<<<<< HEAD
=======
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
} from '@/components/ui/dropdown-menu'
import { ArrowRight, PlusIcon } from 'lucide-react'
import {
  IconPhoto,
  IconAtom,
  IconTool,
  IconCodeCircle2,
  IconPlayerStopFilled,
  IconX,
  IconPaperclip,
  IconLoader2,
<<<<<<< HEAD
  IconCheck,
  IconWorld,
  IconAlertTriangle,
=======
  IconWorld,
  IconBrandChrome,
  IconUser,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
} from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppState } from '@/hooks/useAppState'
import { MovingBorder } from './MovingBorder'
<<<<<<< HEAD
import { useChat } from '@/hooks/useChat'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { ModelLoader } from '@/containers/loaders/ModelLoader'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
=======
import type { ChatStatus } from 'ai'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  TEMPORARY_CHAT_ID,
  TEMPORARY_CHAT_QUERY_ID,
  SESSION_STORAGE_KEY,
  SESSION_STORAGE_PREFIX,
} from '@/constants/chat'
import { localStorageKey } from '@/constants/localStorage'
import { defaultModel } from '@/lib/models'
import { useAssistant } from '@/hooks/useAssistant'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTools } from '@/hooks/useTools'
import { TokenCounter } from '@/components/TokenCounter'
import { useMessages } from '@/hooks/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { McpExtensionToolLoader } from './McpExtensionToolLoader'
import {
  ContentType,
  ExtensionTypeEnum,
  MCPExtension,
  MessageStatus,
  ThreadMessage,
  fs,
  VectorDBExtension,
} from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { useAttachments } from '@/hooks/useAttachments'
import { toast } from 'sonner'
<<<<<<< HEAD
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { isPlatformTauri } from '@/lib/platform/utils'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useAttachmentIngestionPrompt } from '@/hooks/useAttachmentIngestionPrompt'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'

import {
  Attachment,
  createImageAttachment,
  createDocumentAttachment,
} from '@/types/attachment'
import JanBrowserExtensionDialog from '@/containers/dialogs/JanBrowserExtensionDialog'
import { useJanBrowserExtension } from '@/hooks/useJanBrowserExtension'
<<<<<<< HEAD
import { EnhancePromptButton } from '@/components/EnhancePromptButton'
import { usePromptAutocomplete } from '@/hooks/usePromptAutocomplete'
import { PromptSuggestions } from '@/components/PromptSuggestions'
=======
import { PromptVisionModel } from '@/containers/PromptVisionModel'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
  projectId?: string
<<<<<<< HEAD
}

const ChatInput = ({
  model,
  className,
  initialMessage,
  projectId,
=======
  onSubmit?: (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => void
  onStop?: () => void
  chatStatus?: ChatStatus
}

const ChatInput = ({
  className,
  initialMessage,
  projectId,
  onSubmit,
  onStop,
  chatStatus,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
<<<<<<< HEAD
  const [cursorPosition, setCursorPosition] = useState(0)
  const serviceHub = useServiceHub()
  const streamingContent = useAppState((state) => state.streamingContent)
  const abortControllers = useAppState((state) => state.abortControllers)
  const loadingModel = useAppState((state) => state.loadingModel)
=======
  const serviceHub = useServiceHub()
  const abortControllers = useAppState((state) => state.abortControllers)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const updateLoadingModel = useAppState((state) => state.updateLoadingModel)
  const tools = useAppState((state) => state.tools)
  const cancelToolCall = useAppState((state) => state.cancelToolCall)
  const setActiveModels = useAppState((state) => state.setActiveModels)
  const prompt = usePrompt((state) => state.prompt)
  const setPrompt = usePrompt((state) => state.setPrompt)
  const currentThreadId = useThreads((state) => state.currentThreadId)
<<<<<<< HEAD
=======
  const currentThread = useThreads((state) => state.getCurrentThread())
  const updateCurrentThreadAssistant = useThreads(
    (state) => state.updateCurrentThreadAssistant
  )
  const updateCurrentThreadModel = useThreads(
    (state) => state.updateCurrentThreadModel
  )
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const { t } = useTranslation()
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  const tokenCounterCompact = useGeneralSetting(
    (state) => state.tokenCounterCompact
  )
  useTools()
<<<<<<< HEAD
=======
  const router = useRouter()
  const createThread = useThreads((state) => state.createThread)
  const assistants = useAssistant((state) => state.assistants)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  // Get current thread messages for token counting
  const threadMessages = useMessages(
    useShallow((state) =>
      currentThreadId ? state.messages[currentThreadId] : []
    )
  )

  const maxRows = 10
  const ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES = 512 * 1024

  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
<<<<<<< HEAD
  const sendMessage = useChat()
  const {
    suggestions,
    showSuggestions,
    selectedIndex,
    handleKeyDown: handleAutocompleteKeyDown,
    selectSuggestion,
  } = usePromptAutocomplete({
    inputValue: prompt,
    cursorPosition,
  })
=======
  const selectModelProvider = useModelProvider(
    (state) => state.selectModelProvider
  )
  const updateProvider = useModelProvider((state) => state.updateProvider)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipToolsAvailable, setTooltipToolsAvailable] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasMmproj, setHasMmproj] = useState(false)
<<<<<<< HEAD
  const activeModels = useAppState(useShallow((state) => state.activeModels))
  const hasActiveModels = useMemo(
    () =>
      activeModels.length > 0 &&
      activeModels.some((e) => e === selectedModel?.id),
    [activeModels, selectedModel?.id]
  )
=======
  const [showVisionModelPrompt, setShowVisionModelPrompt] = useState(false)
  const activeModels = useAppState(useShallow((state) => state.activeModels))
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | undefined>()
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

  // Jan Browser Extension hook
  const {
    hasConfig: hasJanBrowserMCPConfig,
    isActive: janBrowserMCPActive,
    isLoading: isJanBrowserMCPLoading,
    dialogOpen: extensionDialogOpen,
    dialogState: extensionDialogState,
    toggleBrowser: handleBrowseClick,
    handleCancel: handleExtensionDialogCancel,
    setDialogOpen: setExtensionDialogOpen,
  } = useJanBrowserExtension()

<<<<<<< HEAD
=======
  // Check if model supports browser feature (requires both vision and tools)
  const modelSupportsBrowser = useMemo(() => {
    const capabilities = selectedModel?.capabilities || []
    return capabilities.includes('vision') && capabilities.includes('tools')
  }, [selectedModel?.capabilities])

  // Auto-disable browser feature when model doesn't support it
  useEffect(() => {
    if (janBrowserMCPActive && !modelSupportsBrowser) {
      handleBrowseClick()
    }
  }, [janBrowserMCPActive, modelSupportsBrowser, handleBrowseClick])

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const attachmentsEnabled = useAttachments((s) => s.enabled)
  const parsePreference = useAttachments((s) => s.parseMode)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)
  const autoInlineContextRatio = useAttachments((s) => s.autoInlineContextRatio)
<<<<<<< HEAD
  // Determine whether to show the Attach documents button (simple gating)
  const showAttachmentButton =
    attachmentsEnabled && PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
=======

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  // Derived: any document currently processing (ingestion in progress)
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const attachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const attachmentsKeyRef = useRef(attachmentsKey)
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const transferAttachments = useChatAttachments(
    (state) => state.transferAttachments
  )
  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  useEffect(() => {
    attachmentsKeyRef.current = attachmentsKey
  }, [attachmentsKey])

  const ingestingDocs = attachments.some(
    (a) => a.type === 'document' && a.processing
  )
  const ingestingAny = attachments.some((a) => a.processing)

  const lastTransferredThreadId = useRef<string | null>(null)

  useEffect(() => {
    if (
      currentThreadId &&
      lastTransferredThreadId.current !== currentThreadId
    ) {
      transferAttachments(NEW_THREAD_ATTACHMENT_KEY, currentThreadId)
      lastTransferredThreadId.current = currentThreadId
    }
  }, [currentThreadId, transferAttachments])

  const updateAttachmentProcessing = useCallback(
    (
      fileName: string,
      status: 'processing' | 'done' | 'error' | 'clear_all',
      updatedAttachment?: Partial<Attachment>
    ) => {
      const targetKey = attachmentsKeyRef.current
      const storeState = useChatAttachments.getState()

      // Find all keys that have this attachment (including NEW_THREAD_ATTACHMENT_KEY)
      const allMatchingKeys = Object.entries(storeState.attachmentsByThread)
        .filter(([, list]) => list?.some((att) => att.name === fileName))
        .map(([key]) => key)

      // Always include targetKey and all matching keys
      const keysToUpdate = new Set([targetKey, ...allMatchingKeys])

      const applyUpdate = (key: string) => {
        if (status === 'clear_all') {
          clearAttachmentsForThread(key)
          return
        }

        setAttachmentsForThread(key, (prev) =>
          prev.map((att) =>
            att.name === fileName
              ? {
                  ...att,
                  ...updatedAttachment,
                  processing: status === 'processing',
                  processed:
                    status === 'done'
                      ? true
                      : (updatedAttachment?.processed ?? att.processed),
                }
              : att
          )
        )
      }

      keysToUpdate.forEach((key) => applyUpdate(key as string))
    },
    [clearAttachmentsForThread, setAttachmentsForThread]
  )

  // Check for mmproj existence or vision capability when model changes
  useEffect(() => {
    const checkMmprojSupport = async () => {
      if (selectedModel && selectedModel?.id) {
        try {
          // Only check mmproj for llamacpp provider
          if (selectedModel?.capabilities?.includes('vision')) {
            setHasMmproj(true)
          } else {
            setHasMmproj(false)
          }
        } catch (error) {
          console.error('Error checking mmproj:', error)
          setHasMmproj(false)
        }
      }
    }

    checkMmprojSupport()
  }, [selectedModel, selectedModel?.capabilities, selectedProvider, serviceHub])

  // Check if there are active MCP servers
  const hasActiveMCPServers =
    tools.filter((tool) => tool.server !== 'Jan Browser MCP').length > 0

  // Get MCP extension and its custom component
  const extensionManager = ExtensionManager.getInstance()
  const mcpExtension = extensionManager.get<MCPExtension>(ExtensionTypeEnum.MCP)
  const MCPToolComponent = mcpExtension?.getToolComponent?.()

  const handleSendMessage = async (prompt: string) => {
    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }
    if (!prompt.trim()) {
      return
    }
    if (ingestingAny) {
      toast.info('Please wait for attachments to finish processing')
      return
    }

    setMessage('')

<<<<<<< HEAD
    sendMessage(
      prompt,
      true,
      attachments.length > 0 ? attachments : undefined,
      projectId,
      updateAttachmentProcessing
    )
=======
    // Use onSubmit prop if available (AI SDK), otherwise create thread and navigate
    if (onSubmit) {
      // Build file parts for AI SDK
      const files = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))

      onSubmit(prompt, files.length > 0 ? files : undefined)
      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
    } else {
      // No onSubmit provided - create a new thread and navigate to it
      // Store the initial message in sessionStorage for the thread page to read
      const isTemporaryChat = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      // Build message payload with attachments
      const files = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))

      const messagePayload = {
        text: prompt,
        files: files.length > 0 ? files : [],
      }

      if (isTemporaryChat) {
        // For temporary chat, store message and navigate to temporary thread
        sessionStorage.setItem(
          SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY,
          JSON.stringify(messagePayload)
        )
        sessionStorage.setItem('temp-chat-nav', 'true')
        router.navigate({
          to: route.threadsDetail,
          params: { threadId: TEMPORARY_CHAT_ID },
        })
      } else {
        // Get project metadata and assistant if projectId is provided
        let projectMetadata:
          | { id: string; name: string; updated_at: number }
          | undefined
        let projectAssistantId: string | undefined

        if (projectId) {
          try {
            const project = await serviceHub
              .projects()
              .getProjectById(projectId)
            if (project) {
              projectMetadata = {
                id: project.id,
                name: project.name,
                updated_at: project.updated_at,
              }
              projectAssistantId = project.assistantId
            }
          } catch (e) {
            console.warn('Failed to fetch project metadata:', e)
          }
        }

        // Only use assistant when chatting via project with an assigned assistant
        // When no projectId, use the selected assistant from dropdown (if any)
        const assistant = projectAssistantId
          ? assistants.find((a) => a.id === projectAssistantId)
          : selectedAssistant

        const newThread = await createThread(
          {
            id: selectedModel?.id ?? defaultModel(selectedProvider),
            provider: selectedProvider,
          },
          prompt, // Use prompt as thread title
          assistant,
          projectMetadata
        )

        // Clear selected assistant after creating thread
        setSelectedAssistant(undefined)

        // Store the initial message for the new thread
        sessionStorage.setItem(
          `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${newThread.id}`,
          JSON.stringify(messagePayload)
        )

        router.navigate({
          to: route.threadsDetail,
          params: { threadId: newThread.id },
        })
      }

      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
    }
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  }

  useEffect(() => {
    const handleFocusIn = () => {
      if (document.activeElement === textareaRef.current) {
        setIsFocused(true)
      }
    }

    const handleFocusOut = () => {
      if (document.activeElement !== textareaRef.current) {
        setIsFocused(false)
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  // Focus when component mounts
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (tooltipToolsAvailable && dropdownToolsAvailable) {
      setTooltipToolsAvailable(false)
    }
  }, [dropdownToolsAvailable, tooltipToolsAvailable])

  // Focus when thread changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [currentThreadId])

  // Focus when streaming content finishes
  useEffect(() => {
<<<<<<< HEAD
    if (!streamingContent && textareaRef.current) {
=======
    if (chatStatus !== 'submitted' && textareaRef.current) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      // Small delay to ensure UI has updated
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 10)
    }
<<<<<<< HEAD
  }, [streamingContent])

  const stopStreaming = useCallback(
    (threadId: string) => {
      abortControllers[threadId]?.abort()
      cancelToolCall?.()
    },
    [abortControllers, cancelToolCall]
=======
  }, [chatStatus])

  const stopStreaming = useCallback(
    (threadId: string) => {
      // Use onStop prop if available (AI SDK), otherwise use legacy abort
      if (onStop) {
        onStop()
      } else {
        abortControllers[threadId]?.abort()
      }
      cancelToolCall?.()
    },
    [abortControllers, cancelToolCall, onStop]
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const processNewDocumentAttachments = useCallback(
    async (docs: Attachment[]) => {
      if (!docs.length || !currentThreadId) return

      const modelReady = await (async () => {
        if (!selectedModel?.id) return false
        if (activeModels.includes(selectedModel.id)) return true
        const provider = getProviderByName(selectedProvider)
        if (!provider) return false
        try {
          updateLoadingModel(true)
          await serviceHub.models().startModel(provider, selectedModel.id)
          const active = await serviceHub.models().getActiveModels()
          setActiveModels(active || [])
          return active?.includes(selectedModel.id) ?? false
        } catch (err) {
          console.warn(
            'Failed to start model before attachment validation',
            err
          )
          return false
        } finally {
          updateLoadingModel(false)
        }
      })()

      const modelContextLength = (() => {
        const ctx = selectedModel?.settings?.ctx_len?.controller_props?.value
        if (typeof ctx === 'number') return ctx
        if (typeof ctx === 'string') {
          const parsed = parseInt(ctx, 10)
          return Number.isFinite(parsed) ? parsed : undefined
        }
        return undefined
      })()

      const rawContextThreshold =
        typeof modelContextLength === 'number' && modelContextLength > 0
          ? Math.floor(
              modelContextLength *
                (typeof autoInlineContextRatio === 'number'
                  ? autoInlineContextRatio
                  : 0.75)
            )
          : undefined

      const contextThreshold =
        typeof rawContextThreshold === 'number' &&
        Number.isFinite(rawContextThreshold) &&
        rawContextThreshold > 0
          ? rawContextThreshold
          : undefined

      const hasContextEstimate =
        modelReady &&
        typeof contextThreshold === 'number' &&
        Number.isFinite(contextThreshold) &&
        contextThreshold > 0
      const docsNeedingPrompt = docs.filter((doc) => {
        if (doc.processed || doc.injectionMode) return false
        const preference = doc.parseMode ?? parsePreference
        return (
          preference === 'prompt' ||
          (preference === 'auto' && !hasContextEstimate)
        )
      })

      // Map to store individual choices for each document
      const docChoices = new Map<string, 'inline' | 'embeddings'>()

      if (docsNeedingPrompt.length > 0) {
        // Ask for each file individually
        for (let i = 0; i < docsNeedingPrompt.length; i++) {
          const doc = docsNeedingPrompt[i]
          const choice = await useAttachmentIngestionPrompt
            .getState()
            .showPrompt(
              doc,
              ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES,
              i,
              docsNeedingPrompt.length
            )

          if (!choice) {
            // User cancelled - remove all pending docs
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.filter(
                (att) =>
                  !docsNeedingPrompt.some(
                    (doc) => doc.path && att.path && doc.path === att.path
                  )
              )
            )
            return
          }

          // Store the choice for this specific document
          if (doc.path) {
            docChoices.set(doc.path, choice)
          }
        }
      }

      const estimateTokens = async (
        text: string
      ): Promise<number | undefined> => {
        try {
          if (!selectedModel?.id || !modelReady) return undefined
          const tokenCount = await serviceHub
            .models()
            .getTokensCount(selectedModel.id, [
              {
                id: 'inline-attachment',
                object: 'thread.message',
                thread_id: currentThreadId,
                role: 'user',
                content: [
                  {
                    type: ContentType.Text,
                    text: { value: text, annotations: [] },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now(),
                completed_at: Date.now(),
              } as ThreadMessage,
            ])
          if (
            typeof tokenCount !== 'number' ||
            !Number.isFinite(tokenCount) ||
            tokenCount <= 0
          ) {
            return undefined
          }
          return tokenCount
        } catch (e) {
          console.debug('Failed to estimate tokens for attachment content', e)
          return undefined
        }
      }

      try {
        const { processedAttachments, hasEmbeddedDocuments } =
          await processAttachmentsForSend({
            attachments: docs,
            threadId: currentThreadId,
            serviceHub,
            selectedProvider,
            contextThreshold,
            estimateTokens,
            parsePreference,
            perFileChoices: docChoices.size > 0 ? docChoices : undefined,
            updateAttachmentProcessing,
          })

        if (processedAttachments.length > 0) {
          setAttachmentsForThread(attachmentsKey, (prev) =>
            prev.map((att) => {
              const match = processedAttachments.find(
                (p) => p.path && att.path && p.path === att.path
              )
              return match ? { ...att, ...match } : att
            })
          )
        }

        if (hasEmbeddedDocuments) {
          useThreads.getState().updateThread(currentThreadId, {
            metadata: { hasDocuments: true },
          })
        }
      } catch (e) {
        console.error('Failed to process attachments:', e)
      }
    },
    [
      ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES,
      attachmentsKey,
      autoInlineContextRatio,
      activeModels,
      currentThreadId,
      getProviderByName,
      parsePreference,
      selectedModel?.id,
      selectedModel?.settings?.ctx_len?.controller_props?.value,
      selectedProvider,
      serviceHub,
      setActiveModels,
      setAttachmentsForThread,
      updateAttachmentProcessing,
      updateLoadingModel,
    ]
  )

  const handleAttachDocsIngest = async () => {
    try {
      if (!attachmentsEnabled) {
        toast.info('Attachments are disabled in Settings')
        return
      }
<<<<<<< HEAD
      if (!PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]) {
        toast.info('File attachments are unavailable on this platform')
        return
      }
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      const selection = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Documents',
            extensions: [
              'pdf',
              'docx',
              'txt',
              'md',
              'csv',
              'xlsx',
              'xls',
              'ods',
              'pptx',
              'html',
              'htm',
            ],
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      if (!paths.length) return

      // Prepare attachments with file sizes
      const preparedAttachments: Attachment[] = []
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || p
        const fileType = name.split('.').pop()?.toLowerCase()
        let size: number | undefined = undefined
        try {
          const stat = await fs.fileStat(p)
          size = stat?.size ? Number(stat.size) : undefined
        } catch (e) {
          console.warn('Failed to read file size for', p, e)
        }
        preparedAttachments.push(
          createDocumentAttachment({
            name,
            path: p,
            fileType,
            size,
            parseMode: parsePreference,
          })
        )
      }

      const maxFileSizeBytes =
        typeof maxFileSizeMB === 'number' && maxFileSizeMB > 0
          ? maxFileSizeMB * 1024 * 1024
          : undefined

      if (maxFileSizeBytes !== undefined) {
        const hasOversized = preparedAttachments.some(
          (att) => typeof att.size === 'number' && att.size > maxFileSizeBytes
        )
        if (hasOversized) {
          toast.error('File too large', {
            description: `One or more files exceed the ${maxFileSizeMB}MB limit`,
          })
          return
        }
      }

      let duplicates: string[] = []
      let newDocAttachments: Attachment[] = []

      setAttachmentsForThread(attachmentsKey, (currentAttachments) => {
        const existingPaths = new Set(
          currentAttachments
            .filter((a) => a.type === 'document' && a.path)
            .map((a) => a.path)
        )

        duplicates = []
        newDocAttachments = []

        for (const att of preparedAttachments) {
          if (existingPaths.has(att.path)) {
            duplicates.push(att.name)
            continue
          }
          newDocAttachments.push(att)
        }

        return newDocAttachments.length > 0
          ? [...currentAttachments, ...newDocAttachments]
          : currentAttachments
      })

      if (duplicates.length > 0) {
        toast.warning('Files already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }

      if (newDocAttachments.length > 0) {
        await processNewDocumentAttachments(newDocAttachments)
      }
    } catch (e) {
      console.error('Failed to attach documents:', e)
<<<<<<< HEAD
      const desc = e instanceof Error ? e.message : String(e)
=======
      const desc = e instanceof Error ? e.message : JSON.stringify(e)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      toast.error('Failed to attach documents', { description: desc })
    }
  }

  const handleRemoveAttachment = async (indexToRemove: number) => {
    const attachmentToRemove = attachments[indexToRemove]

    // If attachment was ingested (has an ID), delete it from the backend
    if (attachmentToRemove?.id && currentThreadId) {
      try {
        if (attachmentToRemove.type === 'document') {
          const vectorDBExtension = ExtensionManager.getInstance().get(
            ExtensionTypeEnum.VectorDB
          ) as VectorDBExtension | undefined

          if (vectorDBExtension?.deleteFile) {
            await vectorDBExtension.deleteFile(
              currentThreadId,
              attachmentToRemove.id
            )
          }
        }
      } catch (error) {
        console.error('Failed to delete attachment from backend:', error)
        toast.error('Failed to remove attachment', {
          description: error instanceof Error ? error.message : String(error),
        })
        return
      }
    }

    setAttachmentsForThread(attachmentsKey, (prev) =>
      prev.filter((_, index) => index !== indexToRemove)
    )
  }

  const getFileTypeFromExtension = (fileName: string): string => {
    const extension = fileName.toLowerCase().split('.').pop()
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      default:
        return ''
    }
  }

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return ''
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let val = bytes
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024
      i++
    }
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
  }

  const processImageFiles = async (files: File[]) => {
    const maxSize = 10 * 1024 * 1024 // 10MB in bytes
    const oversizedFiles: string[] = []
    const invalidTypeFiles: string[] = []

    const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png']
    const validFiles: File[] = []

    // First pass: validate file size and type (no duplicate check yet)
    Array.from(files).forEach((file) => {
      // Check file size
      if (file.size > maxSize) {
        oversizedFiles.push(file.name)
        return
      }

      // Get file type - use extension as fallback if MIME type is incorrect
      const detectedType = file.type || getFileTypeFromExtension(file.name)
      const actualType = getFileTypeFromExtension(file.name) || detectedType

      // Check file type - images only
      if (!allowedTypes.includes(actualType)) {
        invalidTypeFiles.push(file.name)
        return
      }

      validFiles.push(file)
    })

    // Process valid files into attachments
    const preparedFiles: Attachment[] = []
    for (const file of validFiles) {
      const detectedType = file.type || getFileTypeFromExtension(file.name)
      const actualType = getFileTypeFromExtension(file.name) || detectedType

      const reader = new FileReader()
      await new Promise<void>((resolve) => {
        reader.onload = () => {
          const result = reader.result
          if (typeof result === 'string') {
            const base64String = result.split(',')[1]
            const att = createImageAttachment({
              name: file.name,
              size: file.size,
              mimeType: actualType,
              base64: base64String,
              dataUrl: result,
            })
            preparedFiles.push(att)
          }
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }

    let duplicates: string[] = []
    let newFiles: Attachment[] = []

    setAttachmentsForThread(attachmentsKey, (currentAttachments) => {
      const existingImageNames = new Set(
        currentAttachments.filter((a) => a.type === 'image').map((a) => a.name)
      )

      duplicates = []
      newFiles = []

      for (const att of preparedFiles) {
        if (existingImageNames.has(att.name)) {
          duplicates.push(att.name)
          continue
        }
        newFiles.push(att)
      }

      if (newFiles.length > 0) {
        return [...currentAttachments, ...newFiles]
      }
      return currentAttachments
    })

    if (currentThreadId && newFiles.length > 0) {
      void (async () => {
        for (const img of newFiles) {
          try {
            // Mark as processing
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.map((a) =>
                a.name === img.name && a.type === 'image'
                  ? { ...a, processing: true }
                  : a
              )
            )

            const result = await serviceHub
              .uploads()
              .ingestImage(currentThreadId, img)

            if (result?.id) {
              // Mark as processed with ID
              setAttachmentsForThread(attachmentsKey, (prev) =>
                prev.map((a) =>
                  a.name === img.name && a.type === 'image'
                    ? {
                        ...a,
                        processing: false,
                        processed: true,
                        id: result.id,
                      }
                    : a
                )
              )
            } else {
              throw new Error('No ID returned from image ingestion')
            }
          } catch (error) {
            console.error('Failed to ingest image:', error)
            // Remove failed image
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.filter((a) => !(a.name === img.name && a.type === 'image'))
            )
            toast.error(`Failed to ingest ${img.name}`, {
              description:
                error instanceof Error ? error.message : String(error),
            })
          }
        }
      })()
    }

    // Display validation errors
    if (duplicates.length > 0) {
      toast.warning('Some images already attached', {
        description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
      })
    }

    const errors: string[] = []
    if (oversizedFiles.length > 0) {
      errors.push(
        `File${oversizedFiles.length > 1 ? 's' : ''} too large (max 10MB): ${oversizedFiles.join(', ')}`
      )
    }

    if (invalidTypeFiles.length > 0) {
      errors.push(
        `Invalid file type${invalidTypeFiles.length > 1 ? 's' : ''} (only JPEG, JPG, PNG allowed): ${invalidTypeFiles.join(', ')}`
      )
    }

    if (errors.length > 0) {
      setMessage(errors.join(' | '))
      // Reset file input to allow re-uploading
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } else {
      setMessage('')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files

    if (files && files.length > 0) {
      void processImageFiles(Array.from(files))

      // Reset the file input value to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

<<<<<<< HEAD
  const handleImagePickerClick = async () => {
=======
  // Open the image picker dialog (extracted for reuse)
  const openImagePicker = useCallback(async () => {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    if (isPlatformTauri()) {
      try {
        const selected = await serviceHub.dialog().open({
          multiple: true,
          filters: [
            {
              name: 'Images',
              extensions: ['jpg', 'jpeg', 'png'],
            },
          ],
        })

        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected]
          const files: File[] = []

          for (const path of paths) {
            try {
              // Use Tauri's convertFileSrc to create a valid URL for the file
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const fileUrl = convertFileSrc(path)

              // Fetch the file as blob
              const response = await fetch(fileUrl)
              if (!response.ok) {
                throw new Error(`Failed to fetch file: ${response.statusText}`)
              }

              const blob = await response.blob()
              const fileName =
                path.split(/[\\/]/).filter(Boolean).pop() || 'image'
              const ext = fileName.toLowerCase().split('.').pop()
              const mimeType =
                ext === 'png'
                  ? 'image/png'
                  : ext === 'jpg' || ext === 'jpeg'
                    ? 'image/jpeg'
                    : 'image/jpeg'

              const file = new File([blob], fileName, { type: mimeType })
              files.push(file)
            } catch (error) {
              console.error('Failed to read file:', error)
              toast.error('Failed to read file', {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }

          if (files.length > 0) {
            await processImageFiles(files)
          }
        }
      } catch (error) {
        console.error('Failed to open file dialog:', error)
      }

      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    } else {
      // Fallback to input click for web
      fileInputRef.current?.click()
    }
<<<<<<< HEAD
  }

=======
  }, [serviceHub, processImageFiles])

  const handleImagePickerClick = async () => {
    if (hasMmproj) {
      await openImagePicker()
      return
    }
    setShowVisionModelPrompt(true)
  }

  const handleVisionModelDownloadComplete = useCallback(
    (modelId: string) => {
      setShowVisionModelPrompt(false)

      try {
        localStorage.setItem(
          localStorageKey.lastUsedModel,
          JSON.stringify({ provider: 'llamacpp', model: modelId })
        )
      } catch {
        // Ignore localStorage errors
      }

      setTimeout(() => {
        const provider = getProviderByName('llamacpp')
        if (provider) {
          const modelIndex = provider.models.findIndex((m) => m.id === modelId)
          if (modelIndex !== -1) {
            const model = provider.models[modelIndex]
            const capabilities = model.capabilities || []

            if (!capabilities.includes('vision')) {
              const updatedModels = [...provider.models]
              updatedModels[modelIndex] = {
                ...model,
                capabilities: [...capabilities, 'vision'],
              }
              updateProvider('llamacpp', { models: updatedModels })
            }
          }
        }

        selectModelProvider('llamacpp', modelId)
        updateCurrentThreadModel({ id: modelId, provider: 'llamacpp' })
      }, 500)
    },
    [
      selectModelProvider,
      getProviderByName,
      updateProvider,
      updateCurrentThreadModel,
    ]
  )

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only allow drag if model supports mmproj
    if (hasMmproj) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragOver to false if we're leaving the drop zone entirely
    // In Tauri, relatedTarget can be null, so we need to handle that case
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Ensure drag state is maintained during drag over
    if (hasMmproj) {
      setIsDragOver(true)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // Only allow drop if model supports mmproj
    if (!hasMmproj) {
      return
    }

    // Check if dataTransfer exists (it might not in some Tauri scenarios)
    if (!e.dataTransfer) {
      console.warn('No dataTransfer available in drop event')
      return
    }

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      // Create a synthetic event to reuse existing file handling logic
      const syntheticEvent = {
        target: {
          files: files,
        },
      } as React.ChangeEvent<HTMLInputElement>

      handleFileChange(syntheticEvent)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    // Only process images if model supports mmproj
    if (hasMmproj) {
      const clipboardItems = e.clipboardData?.items
      let hasProcessedImage = false

      // Try clipboardData.items first (traditional method)
      if (clipboardItems && clipboardItems.length > 0) {
        const imageItems = Array.from(clipboardItems).filter((item) =>
          item.type.startsWith('image/')
        )

        if (imageItems.length > 0) {
          e.preventDefault()

          const files: File[] = []
          let processedCount = 0

          imageItems.forEach((item) => {
            const file = item.getAsFile()
            if (file) {
              files.push(file)
            }
            processedCount++

            // When all items are processed, handle the valid files
            if (processedCount === imageItems.length) {
              if (files.length > 0) {
                const syntheticEvent = {
                  target: {
                    files: files,
                  },
                } as unknown as React.ChangeEvent<HTMLInputElement>

                handleFileChange(syntheticEvent)
                hasProcessedImage = true
              }
            }
          })

          // If we found image items but couldn't get files, fall through to modern API
          if (processedCount === imageItems.length && !hasProcessedImage) {
            // Continue to modern clipboard API fallback below
          } else {
            return // Successfully processed with traditional method
          }
        }
      }

      // Modern Clipboard API fallback (for Linux, images copied from web, etc.)
      if (
        navigator.clipboard &&
        'read' in navigator.clipboard &&
        !hasProcessedImage
      ) {
        try {
          const clipboardContents = await navigator.clipboard.read()
          const files: File[] = []

          for (const item of clipboardContents) {
            const imageTypes = item.types.filter((type) =>
              type.startsWith('image/')
            )

            for (const type of imageTypes) {
              try {
                const blob = await item.getType(type)
                // Convert blob to File with better naming
                const extension = type.split('/')[1] || 'png'
                const file = new File(
                  [blob],
                  `pasted-image-${Date.now()}.${extension}`,
                  { type }
                )
                files.push(file)
              } catch (error) {
                console.error('Error reading clipboard item:', error)
              }
            }
          }

          if (files.length > 0) {
            e.preventDefault()
            const syntheticEvent = {
              target: {
                files: files,
              },
            } as unknown as React.ChangeEvent<HTMLInputElement>

            handleFileChange(syntheticEvent)
            return
          }
        } catch (error) {
          console.error('Clipboard API access failed:', error)
        }
      }

      // If we reach here, no image was found - allow normal text pasting to continue
      console.log(
        'No image data found in clipboard, allowing normal text paste'
      )
    }
    // If hasMmproj is false or no images found, allow normal text pasting to continue
  }

<<<<<<< HEAD
=======
  const isStreaming = chatStatus === 'submitted' || chatStatus === 'streaming'

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  return (
    <div className="relative">
      <div className="relative">
        <div
          className={cn(
<<<<<<< HEAD
            'relative overflow-hidden p-[2px] rounded-lg',
            Boolean(streamingContent) && 'opacity-70'
          )}
        >
          {streamingContent && (
=======
            'relative overflow-hidden p-0.5 rounded-3xl',
            isStreaming && 'opacity-70'
          )}
        >
          {isStreaming && (
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            <div className="absolute inset-0">
              <MovingBorder rx="10%" ry="10%">
                <div
                  className={cn(
                    'h-100 w-100 bg-[radial-gradient(var(--app-primary),transparent_60%)]'
                  )}
                />
              </MovingBorder>
            </div>
          )}

          <div
            className={cn(
<<<<<<< HEAD
              'relative z-20 px-0 pb-10 border border-main-view-fg/5 rounded-lg text-main-view-fg bg-main-view',
              isFocused && 'ring-1 ring-main-view-fg/10',
              isDragOver && 'ring-2 ring-accent border-accent'
=======
              'relative z-20 px-0 pb-10 border rounded-3xl border-input dark:bg-input/30',
              isFocused && 'ring-1 ring-ring/50',
              isDragOver && 'ring-2 ring-ring/50 border-primary'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            )}
            data-drop-zone={hasMmproj ? 'true' : undefined}
            onDragEnter={hasMmproj ? handleDragEnter : undefined}
            onDragLeave={hasMmproj ? handleDragLeave : undefined}
            onDragOver={hasMmproj ? handleDragOver : undefined}
            onDrop={hasMmproj ? handleDrop : undefined}
          >
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 p-2 pb-0">
                <div className="flex gap-3 items-center">
                  {attachments
                    .map((att, idx) => ({ att, idx }))
                    .map(({ att, idx }) => {
                      const isImage = att.type === 'image'
                      const ext = att.fileType || att.mimeType?.split('/')[1]
                      return (
                        <div
                          key={`${att.type}-${idx}-${att.name}`}
                          className="relative"
                        >
<<<<<<< HEAD
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className={cn(
                                    'relative border border-main-view-fg/5 rounded-lg size-14 overflow-hidden bg-main-view/40',
                                    'flex items-center justify-center'
                                  )}
                                >
                                  {/* Inner content by state */}
                                  {isImage && att.dataUrl ? (
                                    <img
                                      className="object-cover w-full h-full"
                                      src={att.dataUrl}
                                      alt={`${att.name}`}
                                    />
                                  ) : (
                                    <div className="flex flex-col items-center justify-center text-main-view-fg/70">
                                      <IconPaperclip size={18} />
                                      {ext && (
                                        <span className="text-[10px] leading-none mt-0.5 uppercase opacity-70">
                                          .{ext}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Overlay spinner when processing */}
                                  {att.processing && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                      <IconLoader2
                                        size={18}
                                        className="text-main-view-fg/80 animate-spin"
                                      />
                                    </div>
                                  )}

                                  {/* Overlay success check when processed */}
                                  {att.processed && !att.processing && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/5">
                                      <div className="bg-green-600/90 rounded-full p-1">
                                        <IconCheck
                                          size={14}
                                          className="text-white"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs">
                                  <div
                                    className="font-medium truncate max-w-52"
                                    title={att.name}
                                  >
                                    {att.name}
                                  </div>
                                  <div className="opacity-70">
                                    {isImage
                                      ? att.mimeType || 'image'
                                      : ext
                                        ? `.${ext}`
                                        : 'document'}
                                    {att.size
                                      ? ` · ${formatBytes(att.size)}`
                                      : ''}
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
=======
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  'relative border rounded-xl size-14 overflow-hidden',
                                  'flex items-center justify-center'
                                )}
                              >
                                {/* Inner content by state */}
                                {isImage && att.dataUrl ? (
                                  <img
                                    className="object-cover w-full h-full"
                                    src={att.dataUrl}
                                    alt={`${att.name}`}
                                  />
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                                    <IconPaperclip size={18} />
                                    {ext && (
                                      <span className="text-[10px] leading-none mt-0.5 uppercase opacity-70">
                                        .{ext}
                                      </span>
                                    )}
                                  </div>
                                )}

                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs">
                                <div
                                  className="font-medium truncate max-w-52"
                                  title={att.name}
                                >
                                  {att.name}
                                </div>
                                <div className="opacity-70">
                                  {isImage
                                    ? att.mimeType || 'image'
                                    : ext
                                      ? `.${ext}`
                                      : 'document'}
                                  {att.size
                                    ? ` · ${formatBytes(att.size)}`
                                    : ''}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

                          {/* Remove button disabled while processing - outside overflow-hidden container */}
                          {!att.processing && (
                            <div
                              className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                              onClick={() => handleRemoveAttachment(idx)}
                            >
                              <IconX
                                className="text-destructive-fg"
                                size={16}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
<<<<<<< HEAD
            {hasActiveMCPServers &&
              !selectedModel?.capabilities?.includes('tools') && (
                <div className="mb-2 mx-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-3">
                  <IconAlertTriangle
                    size={18}
                    className="text-yellow-500 mt-0.5 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-yellow-500 text-sm mb-1">
                      Tool Calling May Be Unavailable
                    </p>
                    <p className="text-xs text-main-view-fg/70">
                      Model{' '}
                      <strong className="text-main-view-fg">
                        {selectedModel?.name}
                      </strong>{' '}
                      may not support tools. MCP tools may not work correctly.{' '}
                      Try{' '}
                      <button
                        className="text-accent hover:underline font-medium"
                        onClick={() => {
                          // Navigate to model settings
                          window.location.hash = `#/models/${selectedModel?.id}`
                        }}
                      >
                        enabling tool support manually
                      </button>{' '}
                      in model settings.
                    </p>
                  </div>
                </div>
              )}
            {showSuggestions && (
              <PromptSuggestions
                suggestions={suggestions}
                selectedIndex={selectedIndex}
                onSelect={(suggestion) => {
                  const result = selectSuggestion(suggestion)
                  setPrompt(result.newValue)
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.focus()
                      textareaRef.current.setSelectionRange(
                        result.newCursorPosition,
                        result.newCursorPosition
                      )
                    }
                  }, 0)
                }}
                position={{ top: -200, left: 0 }}
              />
            )}
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            <TextareaAutosize
              ref={textareaRef}
              minRows={2}
              rows={1}
              maxRows={10}
              value={prompt}
              data-testid={'chat-input'}
              onChange={(e) => {
                setPrompt(e.target.value)
<<<<<<< HEAD
                // Track cursor position for autocomplete
                setCursorPosition(e.target.selectionStart || 0)
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                // Count the number of newlines to estimate rows
                const newRows = (e.target.value.match(/\n/g) || []).length + 1
                setRows(Math.min(newRows, maxRows))
              }}
              onKeyDown={(e) => {
<<<<<<< HEAD
                // Handle autocomplete navigation first
                if (showSuggestions) {
                  const handled = handleAutocompleteKeyDown(e as any)
                  if (handled) return
                }

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                // e.keyCode 229 is for IME input with Safari
                const isComposing =
                  e.nativeEvent.isComposing || e.keyCode === 229
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  // Submit prompt when the following conditions are met:
                  // - Enter is pressed without Shift
                  // - The streaming content has finished
                  // - Prompt is not empty
<<<<<<< HEAD
                  if (!streamingContent && prompt.trim() && !ingestingAny) {
=======
                  if (!isStreaming && prompt.trim() && !ingestingAny) {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    handleSendMessage(prompt)
                  }
                  // When Shift+Enter is pressed, a new line is added (default behavior)
                }
              }}
              onPaste={handlePaste}
              placeholder={t('common:placeholder.chatInput')}
              autoFocus
              spellCheck={spellCheckChatInput}
              data-gramm={spellCheckChatInput}
              data-gramm_editor={spellCheckChatInput}
              data-gramm_grammarly={spellCheckChatInput}
              className={cn(
<<<<<<< HEAD
                'bg-transparent pt-4 w-full flex-shrink-0 border-none resize-none outline-0 px-4',
=======
                'bg-transparent pt-4 w-full shrink-0 border-none resize-none outline-0 px-4',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                rows < maxRows && 'scrollbar-hide',
                className
              )}
            />
          </div>
        </div>

        <div className="absolute z-20 bg-transparent bottom-0 w-full p-2 ">
          <div className="flex justify-between items-center w-full">
            <div className="px-1 flex items-center gap-1 flex-1 min-w-0">
              <div
                className={cn(
                  'px-1 flex items-center w-full gap-1',
<<<<<<< HEAD
                  streamingContent && 'opacity-50 pointer-events-none'
=======
                  isStreaming && 'opacity-50 pointer-events-none'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                )}
              >
                {/* Dropdown for attachments */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
<<<<<<< HEAD
                    <div className="size-7 flex items-center justify-center rounded-full bg-main-view-fg/4 hover:bg-main-view-fg/4 transition-all duration-200 ease-in-out gap-1 mr-2 cursor-pointer">
                      <PlusIcon size={18} className="text-main-view-fg/50" />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {/* Vision image attachment - show only for models with mmproj */}
                    <DropdownMenuItem
                      onClick={handleImagePickerClick}
                      disabled={!hasMmproj}
                    >
                      <IconPhoto size={18} className="text-main-view-fg/50" />
=======
                    <Button variant="secondary" size="icon-sm" className='rounded-full mr-2 mb-1'>
                      <PlusIcon size={18} className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {/* Vision image attachment - always enabled, prompts to download vision model if needed */}
                    <DropdownMenuItem onClick={handleImagePickerClick}>
                      <IconPhoto size={18} className="text-muted-foreground" />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                      <span>Add Images</span>
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        onChange={handleFileChange}
                      />
                    </DropdownMenuItem>
                    {/* RAG document attachments - desktop-only via dialog; shown when feature enabled */}
                    <DropdownMenuItem
                      onClick={handleAttachDocsIngest}
<<<<<<< HEAD
                      disabled={
                        !selectedModel?.capabilities?.includes('tools') &&
                        !showAttachmentButton
                      }
=======
                      disabled={!selectedModel?.capabilities?.includes('tools')}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    >
                      {ingestingDocs ? (
                        <IconLoader2
                          size={18}
<<<<<<< HEAD
                          className="text-main-view-fg/50 animate-spin"
=======
                          className="text-muted-foreground animate-spin"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                        />
                      ) : (
                        <IconPaperclip
                          size={18}
<<<<<<< HEAD
                          className="text-main-view-fg/50"
=======
                          className="text-muted-foreground"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                        />
                      )}
                      <span>
                        {ingestingDocs
                          ? 'Indexing documents…'
                          : 'Add documents or files'}
                      </span>
                    </DropdownMenuItem>
<<<<<<< HEAD
                  </DropdownMenuContent>
                </DropdownMenu>
                {model?.provider === 'llamacpp' && loadingModel ? (
=======
                    {/* Use Assistant - only show when no projectId */}
                    {!projectId && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <IconUser size={18} className="text-muted-foreground" />
                          <span>Use Assistant</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            className={!selectedAssistant && !currentThread?.assistants?.length ? 'bg-accent' : ''}
                            onClick={() => {
                              setSelectedAssistant(undefined)
                              if (currentThreadId) {
                                updateCurrentThreadAssistant(undefined as unknown as Assistant)
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-muted-foreground">—</span>
                              <span>None</span>
                              {!selectedAssistant && !currentThread?.assistants?.length && (
                                <span className="ml-auto text-xs text-muted-foreground">✓</span>
                              )}
                            </div>
                          </DropdownMenuItem>
                          {assistants.length > 0 ? (
                            assistants.map((assistant) => {
                              const isSelected = selectedAssistant?.id === assistant.id ||
                                currentThread?.assistants?.some((a) => a.id === assistant.id)
                              return (
                                <DropdownMenuItem
                                  key={assistant.id}
                                  className={isSelected ? 'bg-accent' : ''}
                                  onClick={() => {
                                    setSelectedAssistant(assistant)
                                    if (currentThreadId) {
                                      updateCurrentThreadAssistant(assistant)
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-2 w-full">
                                    <AvatarEmoji
                                      avatar={assistant.avatar}
                                      imageClassName="w-4 h-4 object-contain"
                                      textClassName="text-sm"
                                    />
                                    <span>{assistant.name || 'Unnamed Assistant'}</span>
                                    {isSelected && (
                                      <span className="ml-auto text-xs text-muted-foreground">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                </DropdownMenuItem>
                              )
                            })
                          ) : (
                            <DropdownMenuItem disabled>
                              <span className="text-muted-foreground">
                                No assistants available
                              </span>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* {model?.provider === 'llamacpp' && loadingModel ? (
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                  <ModelLoader />
                ) : (
                  <DropdownModelProvider
                    model={model}
                    useLastUsedModel={initialMessage}
                  />
<<<<<<< HEAD
                )}
                {/* Microphone - always available - Temp Hide */}
                {/* <div className="h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconMicrophone size={18} className="text-main-view-fg/50" />
              </div> */}
                {selectedModel?.capabilities?.includes('embeddings') && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                          <IconCodeCircle2
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('embeddings')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {selectedModel?.capabilities?.includes('tools') &&
                  hasJanBrowserMCPConfig && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              'h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1 cursor-pointer',
                              janBrowserMCPActive && 'bg-accent/10',
                              isJanBrowserMCPLoading &&
                                'opacity-70 cursor-not-allowed'
                            )}
                            onClick={
                              isJanBrowserMCPLoading
                                ? undefined
                                : handleBrowseClick
                            }
                          >
                            {isJanBrowserMCPLoading ? (
                              <IconLoader2
                                size={18}
                                className="text-accent animate-spin"
                              />
                            ) : (
                              <IconWorld
                                size={18}
                                className={cn(
                                  'text-main-view-fg/50',
                                  janBrowserMCPActive && 'text-accent'
                                )}
                              />
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {isJanBrowserMCPLoading
                              ? 'Starting...'
                              : janBrowserMCPActive
                                ? 'Browse (Active)'
                                : 'Browse'}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
=======
                )} */}
                {hasJanBrowserMCPConfig && modelSupportsBrowser && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={isJanBrowserMCPLoading}
                        className={cn(janBrowserMCPActive && "text-primary")}
                        onClick={
                          isJanBrowserMCPLoading
                            ? undefined
                            : handleBrowseClick
                        }
                      >
                        {isJanBrowserMCPLoading ? (
                          <IconLoader2
                            size={18}
                            className="text-primary animate-spin"
                          />
                        ) : (
                          <IconBrandChrome
                            size={18}
                            className={cn(
                              'text-muted-foreground',
                              janBrowserMCPActive && 'text-primary'
                            )}
                          />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isJanBrowserMCPLoading
                          ? 'Starting...'
                          : janBrowserMCPActive
                            ? 'Browse (Active)'
                            : 'Browse'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}

                {selectedModel?.capabilities?.includes('embeddings') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                          variant="ghost"
                          size="icon-xs"
                        >
                        <IconCodeCircle2
                          size={18}
                          className="text-muted-foreground"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('embeddings')}</p>
                    </TooltipContent>
                  </Tooltip>
                )}

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                {selectedModel?.capabilities?.includes('tools') &&
                  hasActiveMCPServers &&
                  (MCPToolComponent ? (
                    // Use custom MCP component
                    <McpExtensionToolLoader
                      tools={tools}
                      hasActiveMCPServers={hasActiveMCPServers}
                      selectedModelHasTools={
                        selectedModel?.capabilities?.includes('tools') ?? false
                      }
                      initialMessage={initialMessage}
                      MCPToolComponent={MCPToolComponent}
                    />
                  ) : (
                    // Use default tools dropdown
<<<<<<< HEAD
                    <TooltipProvider>
                      <Tooltip
                        open={tooltipToolsAvailable}
                        onOpenChange={setTooltipToolsAvailable}
                      >
                        <TooltipTrigger
                          asChild
                          disabled={dropdownToolsAvailable}
                        >
                          <div
                            onClick={(e) => {
                              setDropdownToolsAvailable(false)
                              e.stopPropagation()
                            }}
                          >
                            <DropdownToolsAvailable
                              initialMessage={initialMessage}
                              onOpenChange={(isOpen) => {
                                setDropdownToolsAvailable(isOpen)
                                if (isOpen) {
                                  setTooltipToolsAvailable(false)
                                }
                              }}
                            >
                              {(isOpen, toolsCount) => {
                                return (
                                  <div
                                    className={cn(
                                      'h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1 cursor-pointer',
                                      isOpen && 'bg-main-view-fg/10',
                                      toolsCount > 0 && 'bg-accent/10'
                                    )}
                                  >
                                    <IconTool
                                      size={18}
                                      className={cn(
                                        'text-main-view-fg/50',
                                        toolsCount > 0 && 'text-accent'
                                      )}
                                    />
                                  </div>
                                )
                              }}
                            </DropdownToolsAvailable>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('tools')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                {selectedModel?.capabilities?.includes('web_search') && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                          <IconWorld
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Web Search</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {selectedModel?.capabilities?.includes('reasoning') && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                          <IconAtom
                            size={18}
                            className="text-main-view-fg/50"
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('reasoning')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
=======
                    <Tooltip
                      open={tooltipToolsAvailable}
                      onOpenChange={setTooltipToolsAvailable}
                    >
                      <TooltipTrigger
                        asChild
                        disabled={dropdownToolsAvailable}
                      >
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            setDropdownToolsAvailable(false)
                            e.stopPropagation()
                          }}
                        >
                          <DropdownToolsAvailable
                            initialMessage={initialMessage}
                            onOpenChange={(isOpen) => {
                              setDropdownToolsAvailable(isOpen)
                              if (isOpen) {
                                setTooltipToolsAvailable(false)
                              }
                            }}
                          >
                            {() => {
                              return (
                                <div
                                  className={cn(
                                    'p-1 flex items-center justify-center rounded-sm transition-all duration-200 ease-in-out gap-1 cursor-pointer',
                                  )}
                                >
                                  <IconTool
                                    size={18}
                                    className={cn(
                                      'text-muted-foreground',
                                    )}
                                  />
                                </div>
                              )
                            }}
                          </DropdownToolsAvailable>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('tools')}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}

                {selectedModel?.capabilities?.includes('web_search') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs">
                        <IconWorld
                          size={18}
                          className="text-muted-foreground"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Web Search</p>
                    </TooltipContent>
                  </Tooltip>
                )}

                {selectedModel?.capabilities?.includes('reasoning') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs">
                        <IconAtom
                          size={18}
                          className="text-muted-foreground"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('reasoning')}</p>
                    </TooltipContent>
                  </Tooltip>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedProvider === 'llamacpp' &&
<<<<<<< HEAD
                hasActiveModels &&
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                tokenCounterCompact &&
                !initialMessage &&
                (threadMessages?.length > 0 || prompt.trim().length > 0) && (
                  <div className="flex-1 flex justify-center">
                    <TokenCounter
                      messages={threadMessages || []}
                      compact={true}
                      uploadedFiles={attachments
                        .filter((a) => a.type === 'image' && a.dataUrl)
                        .map((a) => ({
                          name: a.name,
                          type: a.mimeType || getFileTypeFromExtension(a.name),
                          size: a.size || 0,
                          base64: a.base64 || '',
                          dataUrl: a.dataUrl!,
                        }))}
                    />
                  </div>
                )}

<<<<<<< HEAD
              {!streamingContent && prompt.trim().length > 10 && (
                <EnhancePromptButton
                  prompt={prompt}
                  onEnhanced={(enhanced) => {
                    setPrompt(enhanced)
                    textareaRef.current?.focus()
                  }}
                  modelName={selectedModel?.name}
                  disabled={ingestingAny}
                />
              )}

              {streamingContent ? (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() =>
                    stopStreaming(currentThreadId ?? streamingContent.thread_id)
                  }
=======
              {isStreaming ? (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  className="rounded-full mr-1 mb-1"
                  onClick={() => {
                    if (currentThreadId) stopStreaming(currentThreadId)
                  }}
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                >
                  <IconPlayerStopFilled />
                </Button>
              ) : (
                <Button
<<<<<<< HEAD
                  variant={!prompt.trim() ? null : 'default'}
                  size="icon"
                  disabled={!prompt.trim() || ingestingAny}
                  data-test-id="send-message-button"
                  onClick={() => handleSendMessage(prompt)}
                >
                  {streamingContent || ingestingAny ? (
                    <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <ArrowRight className="text-primary-fg" />
                  )}
=======
                  variant="default"
                  size="icon-sm"
                  disabled={!prompt.trim() || ingestingAny}
                  data-test-id="send-message-button"
                  onClick={() => handleSendMessage(prompt)}
                  className="rounded-full mr-1 mb-1"
                >
                  <ArrowRight className="text-primary-fg" />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {message && (
<<<<<<< HEAD
        <div className="bg-main-view-fg/2 -mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-main-view-fg/30 cursor-pointer"
=======
        <div className="-mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-muted-foreground cursor-pointer"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              onClick={() => {
                setMessage('')
                // Reset file input to allow re-uploading the same file
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }}
            />
          </div>
        </div>
      )}

      {selectedProvider === 'llamacpp' &&
<<<<<<< HEAD
        hasActiveModels &&
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        !tokenCounterCompact &&
        !initialMessage &&
        (threadMessages?.length > 0 || prompt.trim().length > 0) && (
          <div className="flex-1 w-full flex justify-start px-2">
            <TokenCounter
              messages={threadMessages || []}
<<<<<<< HEAD
              compact={false}
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              uploadedFiles={attachments
                .filter((a) => a.type === 'image' && a.dataUrl)
                .map((a) => ({
                  name: a.name,
                  type: a.mimeType || getFileTypeFromExtension(a.name),
                  size: a.size || 0,
                  base64: a.base64 || '',
                  dataUrl: a.dataUrl!,
                }))}
            />
          </div>
        )}

      <JanBrowserExtensionDialog
        open={extensionDialogOpen}
        onOpenChange={setExtensionDialogOpen}
        state={extensionDialogState}
        onCancel={handleExtensionDialogCancel}
      />
<<<<<<< HEAD
=======

      {/* Vision Model Download Prompt */}
      <PromptVisionModel
        open={showVisionModelPrompt}
        onClose={() => setShowVisionModelPrompt(false)}
        onDownloadComplete={handleVisionModelDownloadComplete}
      />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    </div>
  )
}

export default ChatInput

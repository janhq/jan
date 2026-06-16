import { EMBEDDING_MODEL_ID } from '@/constants/models'
import TextareaAutosize from 'react-textarea-autosize'
import { cn, formatBytes, LOCAL_LLAMACPP_PROVIDER } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowRight, PlusIcon } from 'lucide-react'
import {
  IconPhoto,
  IconTool,
  IconCodeCircle2,
  IconPlayerStopFilled,
  IconX,
  IconPaperclip,
  IconLoader2,
  IconWorld,
} from '@tabler/icons-react'
import { BotIcon } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppState } from '@/hooks/useAppState'
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'
import type { ChatStatus } from 'ai'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { TEMPORARY_CHAT_ID, TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
import { useInitialMessage } from '@/hooks/useInitialMessage'
import { useOptimisticUserMessage } from '@/hooks/useOptimisticUserMessage'
import { buildOptimisticUserMessage } from '@/lib/optimisticUserMessage'
import { localStorageKey } from '@/constants/localStorage'
import { defaultModel } from '@/lib/models'
import { useAssistant } from '@/hooks/useAssistant'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
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
import { AttachmentChip } from '@/containers/AttachmentChip'
import { readImageAttachmentFromPath } from '@/containers/chatInput/imageFromPath'
import { downscaleImageDataUrl } from '@/lib/imageDownscale'
import { useTauriDragDrop } from '@/containers/chatInput/useTauriDragDrop'
import {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  classifyDroppedPaths,
} from '@/containers/chatInput/classifyDroppedPaths'
import JanBrowserExtensionDialog from '@/containers/dialogs/JanBrowserExtensionDialog'
import { useJanBrowserExtension } from '@/hooks/useJanBrowserExtension'
import { PromptVisionModel } from '@/containers/PromptVisionModel'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import ReasoningToggle from '@/containers/ReasoningToggle'
import { ttftPreBegin } from '@/lib/ttft-timing'
import { ModelFactory } from '@/lib/model-factory'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
  projectId?: string
  onSubmit?: (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => void
  onStop?: () => void
  chatStatus?: ChatStatus
}

const ChatInput = memo(function ChatInput({
  className,
  initialMessage,
  projectId,
  onSubmit,
  onStop,
  chatStatus,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const serviceHub = useServiceHub()
  const abortControllers = useAppState((state) => state.abortControllers)
  const loadingModel = useAppState((state) => state.loadingModel)
  const serverStatus = useAppState((state) => state.serverStatus)
  const tools = useAppState((state) => state.tools)
  const cancelToolCall = useAppState((state) => state.cancelToolCall)
  const prompt = usePrompt((state) => state.prompt)
  const setPrompt = usePrompt((state) => state.setPrompt)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const updateCurrentThreadModel = useThreads(
    (state) => state.updateCurrentThreadModel
  )
  const { t } = useTranslation()
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  const tokenCounterCompact = useGeneralSetting(
    (state) => state.tokenCounterCompact
  )
  const maxImageSizePx = useGeneralSetting((state) => state.maxImageSizePx)
  useTools()
  const router = useRouter()
  const createThread = useThreads((state) => state.createThread)
  const assistants = useAssistant((state) => state.assistants)
  const defaultAssistantId = useAssistant((state) => state.defaultAssistantId)

  // Agent mode
  // Use TEMPORARY_CHAT_ID as fallback key on the home screen (same pattern as attachments)
  const agentModeKey = currentThreadId ?? TEMPORARY_CHAT_ID
  const isAgentMode = useAgentMode(
    (state) => state.agentThreads[agentModeKey] === true
  )
  // When projectId is present, treat as normal chat (disable agent mode UI)
  const effectiveAgentMode = isAgentMode && !projectId
  const toggleAgentMode = useAgentMode((state) => state.toggleAgentMode)

  const handleAgentToggle = useCallback(() => {
    toggleAgentMode(agentModeKey)
  }, [agentModeKey, toggleAgentMode])

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
  const selectModelProvider = useModelProvider(
    (state) => state.selectModelProvider
  )
  const updateProvider = useModelProvider((state) => state.updateProvider)
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipToolsAvailable, setTooltipToolsAvailable] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasMmproj, setHasMmproj] = useState(false)
  const [showVisionModelPrompt, setShowVisionModelPrompt] = useState(false)
  const [isPreparingDocumentAttachments, setIsPreparingDocumentAttachments] =
    useState(false)
  const activeModels = useAppState(useShallow((state) => state.activeModels))

  const isModelActive = selectedModel?.id
    ? activeModels.includes(selectedModel.id)
    : false

  // Auto-start local model (llamacpp/mlx) when selected so the indicator and send
  // button reflect its status. Uses the unified switchToModel to ensure only one
  // model runs across all local providers. switchToModel manages loadingModel,
  // activeModels and is serialised, so no manual state juggling is needed here.
  useEffect(() => {
    const isLocal =
      selectedProvider === 'mlx' ||
      selectedProvider === 'llamacpp' ||
      selectedProvider === 'llamacpp-upstream'
    if (
      !isLocal ||
      !selectedModel?.id ||
      loadingModel ||
      serverStatus === 'pending'
    )
      return

    let cancelled = false

    const ensureLocalModelRunning = async () => {
      try {
        const [actualActive, activeAcrossProviders] = await Promise.all([
          serviceHub.models().getActiveModels(selectedProvider),
          serviceHub.models().getActiveModels(),
        ])
        if (cancelled) return

        // getActiveModels() only inspects on-device engines; merge with any
        // cloud model that was activated elsewhere so we don't wipe it on
        // every navigation into a thread.
        syncActiveModelsFromEngines(activeAcrossProviders || [])

        if (
          actualActive.length === 1 &&
          actualActive[0] === selectedModel.id &&
          activeAcrossProviders.length === 1 &&
          activeAcrossProviders[0] === selectedModel.id
        ) {
          return
        }

        const { switchToModel, shouldAttemptAutoStart } = await import(
          '@/utils/switchModel'
        )
        if (cancelled) return
        // WS2: don't auto-retry a model that just failed terminally (missing
        // file/binary) or is still within its backoff window — this is what
        // turned a failed load into a tight restart loop. Explicit user
        // switches (dropdown/send) don't go through this gate.
        if (!shouldAttemptAutoStart(selectedProvider, selectedModel.id)) return
        await switchToModel({
          modelId: selectedModel.id,
          providerName: selectedProvider,
          serviceHub,
        })
      } catch (err) {
        console.warn('Failed to auto-start local model:', err)
      }
    }

    ensureLocalModelRunning()
    return () => {
      cancelled = true
    }
  }, [
    loadingModel,
    selectedProvider,
    selectedModel?.id,
    serverStatus,
    serviceHub,
  ])

  const isLocalModelNotReady =
    (selectedProvider === 'mlx' ||
      selectedProvider === 'llamacpp' ||
      selectedProvider === 'llamacpp-upstream') &&
    !!selectedModel?.id &&
    !activeModels.includes(selectedModel.id)

  const blockSendUntilModelReady = isLocalModelNotReady && !!onSubmit

  const selectedAssistant = useAssistant((state) => state.pendingAssistant)
  const setSelectedAssistant = useAssistant(
    (state) => state.setPendingAssistant
  )

  // No auto-selection: let the user explicitly pick an assistant

  // Jan Browser Extension hook
  const {
    //! при возврате кнопки Browse: hasConfig: hasJanBrowserMCPConfig, isLoading: isJanBrowserMCPLoading,
    isActive: janBrowserMCPActive,
    dialogOpen: extensionDialogOpen,
    dialogState: extensionDialogState,
    toggleBrowser: handleBrowseClick,
    handleCancel: handleExtensionDialogCancel,
    setDialogOpen: setExtensionDialogOpen,
  } = useJanBrowserExtension()

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

  const attachmentsEnabled = useAttachments((s) => s.enabled)
  const parsePreference = useAttachments((s) => s.parseMode)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)
  const autoInlineContextRatio = useAttachments((s) => s.autoInlineContextRatio)

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
  const { downloads, localDownloadingModels } = useDownloadStore(
    useShallow((state) => ({
      downloads: state.downloads,
      localDownloadingModels: state.localDownloadingModels,
    }))
  )

  useEffect(() => {
    attachmentsKeyRef.current = attachmentsKey
  }, [attachmentsKey])

  const ingestingDocs = attachments.some(
    (a) => a.type === 'document' && a.processing
  )
  const ingestingAny = attachments.some((a) => a.processing)
  const hasPendingDocumentAttachments = attachments.some(
    (a) => a.type === 'document' && !a.processed
  )
  const embeddingModelDownload = downloads[EMBEDDING_MODEL_ID]
  const isEmbeddingModelDownloading =
    localDownloadingModels.has(EMBEDDING_MODEL_ID) || !!embeddingModelDownload
  const isAttachmentPipelineBusy =
    ingestingAny ||
    isPreparingDocumentAttachments ||
    (hasPendingDocumentAttachments &&
      (isEmbeddingModelDownloading || !!loadingModel))

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
    if (isAttachmentPipelineBusy) {
      toast.info('Please wait for attachments to finish processing')
      return
    }

    setMessage('')

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

      // Snapshot documents synchronously before any await/navigation so the
      // store can be cleared immediately while we still know what to forward
      // to the new thread page.
      const docsSnapshot = attachments
        .filter((att) => att.type === 'document')
        .map((att) => ({ ...att }))

      const messagePayload = {
        text: prompt,
        files: files.length > 0 ? files : [],
        documents: docsSnapshot.length > 0 ? docsSnapshot : undefined,
      }

      // Clear input UI immediately so the chip and text disappear in the
      // same frame as the click. Otherwise the chip lingers under the new
      // thread's key (transferAttachments runs during await createThread)
      // until processAttachmentsForSend finishes indexing the document.
      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)

      // #region agent log
      ttftPreBegin('home-submit-click', {
        isTemporaryChat,
        hasFiles: files.length > 0,
        hasDocs: docsSnapshot.length > 0,
        selectedProvider,
        selectedModelId: selectedModel?.id,
      })
      // #endregion

      // Pre-warm the local llama.cpp / MLX session in parallel with
      // createThread + navigation + ThreadDetail mount. By the time
      // `CustomChatTransport.sendMessages` calls `ModelFactory.createModel`,
      // the session-cache entry is already populated and the IPC round-trips
      // (`startModel` + `find_session_by_model`) are skipped, shaving
      // ~150–220ms off the critical path. Fire-and-forget — failures fall
      // back to the regular discovery path inside `createModel`.
      if (selectedModel?.id) {
        const prewarmProvider = getProviderByName(selectedProvider)
        if (prewarmProvider) {
          // #region agent log
          ttftPreBegin('prewarm-session-start', {
            provider: selectedProvider,
            modelId: selectedModel.id,
          })
          // #endregion
          void ModelFactory.prewarmSession(
            selectedProvider,
            selectedModel.id,
            prewarmProvider
          ).then(() => {
            // #region agent log
            ttftPreBegin('prewarm-session-done', {
              provider: selectedProvider,
              modelId: selectedModel.id,
            })
            // #endregion
          })
        }
      }

      if (isTemporaryChat) {
        // Stash payload in-memory keyed by the temporary thread id; the thread
        // page consumes it on mount. We avoid sessionStorage because base64
        // image data URLs can exceed the per-origin quota and silently abort
        // navigation with QuotaExceededError.
        useInitialMessage.getState().set(TEMPORARY_CHAT_ID, messagePayload)
        if (isAgentMode && agentModeKey !== TEMPORARY_CHAT_ID) {
          useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
          useAgentMode.getState().removeThread(agentModeKey)
        }
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
          : (selectedAssistant ??
            assistants.find((a) => a.id === defaultAssistantId) ??
            assistants[0])

        // #region agent log
        ttftPreBegin('before-createThread')
        // #endregion
        const newThread = await createThread(
          {
            id: selectedModel?.id ?? defaultModel(selectedProvider),
            provider: selectedProvider,
          },
          prompt, // Use prompt as thread title
          assistant,
          projectMetadata
        )
        // #region agent log
        ttftPreBegin('after-createThread', { newThreadId: newThread.id })
        // #endregion

        // Clear selected assistant after creating thread
        setSelectedAssistant(undefined)

        // Mark the new thread with hasDocuments if any documents were embedded
        const hasEmbeddedDocs = attachments.some(
          (a) =>
            a.type === 'document' &&
            a.processed &&
            a.injectionMode === 'embeddings'
        )
        console.log(
          '[ChatInput:home] newThread:',
          newThread.id,
          'attachments:',
          attachments.length,
          'hasEmbeddedDocs:',
          hasEmbeddedDocs,
          'attachment states:',
          attachments.map((a) => ({
            name: a.name,
            type: a.type,
            processed: a.processed,
            injectionMode: a.injectionMode,
          }))
        )
        if (hasEmbeddedDocs) {
          useThreads.getState().updateThread(newThread.id, {
            metadata: { hasDocuments: true },
          })
          console.log(
            '[ChatInput:home] Set hasDocuments=true on thread',
            newThread.id
          )
        }

        // Transfer agent mode from home screen to the new thread
        if (isAgentMode) {
          useAgentMode.getState().setAgentMode(newThread.id, true)
          useAgentMode.getState().removeThread(agentModeKey)
        }

        useInitialMessage.getState().set(newThread.id, messagePayload)

        // Publish the optimistic user bubble before navigation so the
        // thread page renders it on its very first paint, even under
        // React StrictMode's mount → unmount → remount dev cycle. The
        // store-backed approach is independent of useState lazy-init
        // timing.
        const optimisticBubble = buildOptimisticUserMessage({
          threadId: newThread.id,
          text: prompt,
          imageFiles: files,
          documents: docsSnapshot,
        })
        if (optimisticBubble) {
          useOptimisticUserMessage
            .getState()
            .set(newThread.id, optimisticBubble)
        }

        // #region agent log
        ttftPreBegin('before-navigate', { newThreadId: newThread.id })
        // #endregion
        router.navigate({
          to: route.threadsDetail,
          params: { threadId: newThread.id },
        })
      }
    }
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
    if (chatStatus !== 'submitted' && textareaRef.current) {
      // Small delay to ensure UI has updated
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 10)
    }
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
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const processNewDocumentAttachments = useCallback(
    async (docs: Attachment[]) => {
      if (!docs.length || !currentThreadId) return
      setIsPreparingDocumentAttachments(true)

      try {
        const modelReady = await (async () => {
          if (!selectedModel?.id) return false
          if (activeModels.includes(selectedModel.id)) return true
          const isLocal =
            selectedProvider === 'llamacpp' ||
            selectedProvider === 'llamacpp-upstream' ||
            selectedProvider === 'mlx'
          if (!isLocal) return false
          try {
            const { switchToModel } = await import('@/utils/switchModel')
            await switchToModel({
              modelId: selectedModel.id,
              providerName: selectedProvider,
              serviceHub,
            })
            return (
              useAppState.getState().activeModels?.includes(selectedModel.id) ??
              false
            )
          } catch (err) {
            console.warn(
              'Failed to start model before attachment validation',
              err
            )
            return false
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
      } finally {
        setIsPreparingDocumentAttachments(false)
      }
    },
    [
      ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES,
      attachmentsKey,
      autoInlineContextRatio,
      activeModels,
      currentThreadId,
      parsePreference,
      selectedModel?.id,
      selectedModel?.settings?.ctx_len?.controller_props?.value,
      selectedProvider,
      serviceHub,
      setAttachmentsForThread,
      updateAttachmentProcessing,
    ]
  )

  const ingestDocumentPaths = useCallback(
    async (paths: readonly string[]) => {
      if (!paths.length) return
      try {
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
        const desc = e instanceof Error ? e.message : JSON.stringify(e)
        toast.error('Failed to attach documents', { description: desc })
      }
    },
    [
      attachmentsKey,
      maxFileSizeMB,
      parsePreference,
      processNewDocumentAttachments,
      setAttachmentsForThread,
    ]
  )

  const handleAttachDocsIngest = async () => {
    if (!attachmentsEnabled) {
      toast.info('Attachments are disabled in Settings')
      return
    }
    try {
      const selection = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Documents & Code',
            extensions: [...DOCUMENT_EXTENSIONS],
          },
          {
            name: 'All Files',
            extensions: ['*'],
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      await ingestDocumentPaths(paths)
    } catch (e) {
      console.error('Failed to open documents dialog:', e)
      const desc = e instanceof Error ? e.message : JSON.stringify(e)
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

  const handleRetryAttachment = async (indexToRetry: number) => {
    const att = attachments[indexToRetry]
    if (!att || att.type !== 'document' || !att.error) return

    const cleaned: Attachment = {
      ...att,
      error: undefined,
      processing: true,
      processed: false,
    }

    setAttachmentsForThread(attachmentsKey, (prev) =>
      prev.map((a, i) => (i === indexToRetry ? cleaned : a))
    )

    await processNewDocumentAttachments([cleaned])
  }

  const getFileTypeFromExtension = (fileName: string): string => {
    const extension = fileName.toLowerCase().split('.').pop()
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      case 'webp':
        return 'image/webp'
      default:
        return ''
    }
  }

  const embeddingModelStatusText = useMemo(() => {
    if (!hasPendingDocumentAttachments || !isEmbeddingModelDownloading) {
      return undefined
    }

    const percent =
      typeof embeddingModelDownload?.progress === 'number'
        ? Math.round(embeddingModelDownload.progress * 100)
        : undefined
    const transferred = formatBytes(embeddingModelDownload?.current)
    const total = formatBytes(embeddingModelDownload?.total)
    const sizeLabel =
      transferred && total
        ? `${transferred} / ${total}`
        : total || transferred || undefined

    const details = [
      percent !== undefined ? `${percent}%` : undefined,
      sizeLabel,
    ]
      .filter(Boolean)
      .join(' · ')

    return details
      ? `Downloading embedding model ${EMBEDDING_MODEL_ID}... ${details}`
      : `Downloading embedding model ${EMBEDDING_MODEL_ID}...`
  }, [
    embeddingModelDownload,
    hasPendingDocumentAttachments,
    isEmbeddingModelDownloading,
  ])

  const hashBase64 = async (base64: string): Promise<string> => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024
  const IMAGE_ALLOWED_MIME_TYPES = [
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]

  type ImageValidationOutcome = {
    candidates: Attachment[]
    oversized: string[]
    invalidType: string[]
  }

  const prepareImageAttachmentsFromFiles = async (
    files: readonly File[]
  ): Promise<ImageValidationOutcome> => {
    const oversized: string[] = []
    const invalidType: string[] = []
    const validFiles: File[] = []

    for (const file of files) {
      if (file.size > IMAGE_MAX_SIZE_BYTES) {
        oversized.push(file.name)
        continue
      }
      const detectedType = file.type || getFileTypeFromExtension(file.name)
      const actualType = getFileTypeFromExtension(file.name) || detectedType
      if (!IMAGE_ALLOWED_MIME_TYPES.includes(actualType)) {
        invalidType.push(file.name)
        continue
      }
      validFiles.push(file)
    }

    const candidates: Attachment[] = []
    for (const file of validFiles) {
      const detectedType = file.type || getFileTypeFromExtension(file.name)
      const actualType = getFileTypeFromExtension(file.name) || detectedType

      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result
          resolve(typeof result === 'string' ? result : null)
        }
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })
      if (!dataUrl) continue

      // Downscale oversized images before they enter the conversation so they
      // don't flood the model's context (see "Max image size" setting).
      const downscaled = await downscaleImageDataUrl(
        dataUrl,
        maxImageSizePx,
        actualType
      )

      candidates.push(
        createImageAttachment({
          name: file.name,
          size: downscaled?.size ?? file.size,
          mimeType: downscaled?.mimeType ?? actualType,
          base64: downscaled?.base64 ?? dataUrl.split(',')[1] ?? '',
          dataUrl: downscaled?.dataUrl ?? dataUrl,
        })
      )
    }

    return { candidates, oversized, invalidType }
  }

  const prepareImageAttachmentsFromPaths = async (
    paths: readonly string[]
  ): Promise<ImageValidationOutcome> => {
    const oversized: string[] = []
    const invalidType: string[] = []
    const candidates: Attachment[] = []

    for (const p of paths) {
      const ext = (p.split(/[\\/]/).pop()?.split('.').pop() || '').toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) {
        invalidType.push(p.split(/[\\/]/).pop() || p)
        continue
      }
      try {
        const att = await readImageAttachmentFromPath(p)
        if (typeof att.size === 'number' && att.size > IMAGE_MAX_SIZE_BYTES) {
          oversized.push(att.name)
          continue
        }
        // Downscale oversized images so they don't flood the model's context.
        if (att.dataUrl) {
          const downscaled = await downscaleImageDataUrl(
            att.dataUrl,
            maxImageSizePx,
            att.mimeType
          )
          if (downscaled) {
            att.dataUrl = downscaled.dataUrl
            att.base64 = downscaled.base64
            att.mimeType = downscaled.mimeType
            att.size = downscaled.size
          }
        }
        candidates.push(att)
      } catch (e) {
        console.error('Failed to read dropped image', p, e)
        invalidType.push(p.split(/[\\/]/).pop() || p)
      }
    }

    return { candidates, oversized, invalidType }
  }

  const commitImageAttachments = async (
    outcome: ImageValidationOutcome
  ): Promise<void> => {
    const { candidates, oversized, invalidType } = outcome

    for (const att of candidates) {
      if (att.base64) {
        att.contentHash = await hashBase64(att.base64)
      }
    }

    const currentAttachments = useChatAttachments
      .getState()
      .getAttachments(attachmentsKey)

    const existingImageHashes = new Set<string>()
    const existingImageNames = new Set<string>()
    for (const a of currentAttachments) {
      if (a.type !== 'image') continue
      if (a.contentHash) {
        existingImageHashes.add(a.contentHash)
      } else if (a.base64) {
        existingImageHashes.add(await hashBase64(a.base64))
      } else {
        existingImageNames.add(a.name)
      }
    }

    const duplicates: string[] = []
    const newFiles: Attachment[] = []
    const seenHashesInBatch = new Set<string>()
    for (const att of candidates) {
      const hash = att.contentHash
      const isDuplicateByContent =
        hash && (existingImageHashes.has(hash) || seenHashesInBatch.has(hash))
      const isDuplicateByName = existingImageNames.has(att.name)
      if (isDuplicateByContent || isDuplicateByName) {
        duplicates.push(att.name)
        continue
      }
      if (hash) {
        seenHashesInBatch.add(hash)
      }
      newFiles.push(att)
    }

    setAttachmentsForThread(attachmentsKey, (prev) =>
      newFiles.length > 0 ? [...prev, ...newFiles] : prev
    )

    if (currentThreadId && newFiles.length > 0) {
      void (async () => {
        for (const img of newFiles) {
          const matchImg = (a: Attachment) =>
            a.type === 'image' &&
            (img.contentHash
              ? a.contentHash === img.contentHash
              : a.name === img.name)

          try {
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.map((a) => (matchImg(a) ? { ...a, processing: true } : a))
            )

            const result = await serviceHub
              .uploads()
              .ingestImage(currentThreadId, img)

            if (result?.id) {
              setAttachmentsForThread(attachmentsKey, (prev) =>
                prev.map((a) =>
                  matchImg(a)
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
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.filter((a) => !matchImg(a))
            )
            toast.error(`Failed to ingest ${img.name}`, {
              description:
                error instanceof Error ? error.message : String(error),
            })
          }
        }
      })()
    }

    if (duplicates.length > 0) {
      toast.warning('Some images already attached', {
        description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
      })
    }

    const errors: string[] = []
    if (oversized.length > 0) {
      errors.push(
        `File${oversized.length > 1 ? 's' : ''} too large (max 10MB): ${oversized.join(', ')}`
      )
    }

    if (invalidType.length > 0) {
      errors.push(
        `Invalid file type${invalidType.length > 1 ? 's' : ''} (only JPEG, JPG, PNG, WEBP allowed): ${invalidType.join(', ')}`
      )
    }

    if (errors.length > 0) {
      setMessage(errors.join(' | '))
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } else {
      setMessage('')
    }
  }

  const processImageFiles = async (files: File[]) => {
    const outcome = await prepareImageAttachmentsFromFiles(files)
    await commitImageAttachments(outcome)
  }

  const ingestImagePaths = async (paths: readonly string[]) => {
    const outcome = await prepareImageAttachmentsFromPaths(paths)
    await commitImageAttachments(outcome)
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

  // Open the image picker dialog (extracted for reuse)
  const openImagePicker = useCallback(async () => {
    if (isPlatformTauri()) {
      try {
        const selected = await serviceHub.dialog().open({
          multiple: true,
          filters: [
            {
              name: 'Images',
              extensions: ['jpg', 'jpeg', 'png', 'webp'],
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
                  : ext === 'webp'
                    ? 'image/webp'
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
          JSON.stringify({
            provider: LOCAL_LLAMACPP_PROVIDER,
            model: modelId,
          })
        )
      } catch {
        // Ignore localStorage errors
      }

      setTimeout(() => {
        // `getProviderByName('llamacpp')` is alias-aware on Windows and
        // returns the upstream provider, but `updateProvider` is not — so
        // we must address the canonical id for the platform here, otherwise
        // the vision capability is never persisted on Windows.
        const provider = getProviderByName(LOCAL_LLAMACPP_PROVIDER)
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
              updateProvider(LOCAL_LLAMACPP_PROVIDER, {
                models: updatedModels,
              })
            }
          }
        }

        selectModelProvider(LOCAL_LLAMACPP_PROVIDER, modelId)
        updateCurrentThreadModel({
          id: modelId,
          provider: LOCAL_LLAMACPP_PROVIDER,
        })
      }, 500)
    },
    [
      selectModelProvider,
      getProviderByName,
      updateProvider,
      updateCurrentThreadModel,
    ]
  )

  const handleTauriDrop = (paths: string[]) => {
    if (!attachmentsEnabled) {
      toast.info('Attachments are disabled in Settings')
      return
    }
    const { images, docs, unsupported } = classifyDroppedPaths(paths)

    if (unsupported.length > 0) {
      const names = unsupported.map((p) => p.split(/[\\/]/).pop() || p)
      toast.warning('Unsupported file type', {
        description: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not supported`,
      })
    }

    if (images.length > 0) {
      if (!hasMmproj) {
        toast.error('Vision model required', {
          description: 'Select a model with vision support to attach images.',
        })
      } else {
        void ingestImagePaths(images)
      }
    }

    if (docs.length > 0) {
      void ingestDocumentPaths(docs)
    }
  }

  useTauriDragDrop({
    enabled: attachmentsEnabled,
    onDragOver: () => setIsDragOver(true),
    onDragLeave: () => setIsDragOver(false),
    onDrop: handleTauriDrop,
  })

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (attachmentsEnabled) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragOver to false if we're leaving the drop zone entirely
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (attachmentsEnabled) {
      setIsDragOver(true)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!attachmentsEnabled) return

    // NOTE: in Tauri with `dragDropEnabled: true` the WebView never delivers
    // file drops as HTML5 events — they all flow through `useTauriDragDrop`.
    // This handler still runs on the web build and on Tauri builds where the
    // config change has not yet been picked up by the running binary.
    if (!e.dataTransfer) {
      console.warn('No dataTransfer available in drop event')
      return
    }

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const fileArr = Array.from(files)
    const imageFiles = fileArr.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return IMAGE_EXTENSIONS.has(ext) || f.type.startsWith('image/')
    })
    const nonImageFiles = fileArr.filter((f) => !imageFiles.includes(f))

    if (nonImageFiles.length > 0) {
      const names = nonImageFiles.map((f) => f.name)
      toast.warning('Document drag-and-drop unavailable here', {
        description: `${names.join(', ')} - drop documents in the desktop app or use the attach menu.`,
      })
    }

    if (imageFiles.length === 0) return

    if (!hasMmproj) {
      toast.error('Vision model required', {
        description: 'Select a model with vision support to attach images.',
      })
      return
    }

    void processImageFiles(imageFiles)
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

  const isStreaming = chatStatus === 'submitted' || chatStatus === 'streaming'

  return (
    <div className="relative">
      <div className="relative">
        <div
          className={cn(
            'relative overflow-hidden p-0.5 rounded-3xl',
            isStreaming && 'opacity-70'
          )}
        >
          <div
            className={cn(
              'relative z-20 px-0 pb-10 border rounded-3xl border-input bg-white dark:bg-input/30',
              isFocused && 'ring-1 ring-ring/50',
              isDragOver && 'ring-2 ring-ring/50 border-primary'
            )}
            data-drop-zone={attachmentsEnabled ? 'true' : undefined}
            onDragEnter={attachmentsEnabled ? handleDragEnter : undefined}
            onDragLeave={attachmentsEnabled ? handleDragLeave : undefined}
            onDragOver={attachmentsEnabled ? handleDragOver : undefined}
            onDrop={attachmentsEnabled ? handleDrop : undefined}
          >
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 p-2 pb-0">
                <div className="flex flex-wrap gap-2 items-center">
                  {attachments
                    .map((att, idx) => ({ att, idx }))
                    .map(({ att, idx }) => {
                      const isImage = att.type === 'image'
                      const ext = att.fileType || att.mimeType?.split('/')[1]
                      const showAttachmentLoader =
                        (att.processing ||
                          (att.type === 'document' &&
                            !att.processed &&
                            isAttachmentPipelineBusy)) &&
                        !att.error

                      if (!isImage) {
                        return (
                          <AttachmentChip
                            key={`${att.type}-${idx}-${att.name}`}
                            name={att.name}
                            fileType={att.fileType}
                            mimeType={att.mimeType}
                            size={att.size}
                            error={att.error}
                            isProcessing={showAttachmentLoader}
                            onRemove={() => handleRemoveAttachment(idx)}
                            onRetry={() => handleRetryAttachment(idx)}
                          />
                        )
                      }

                      return (
                        <div
                          key={`${att.type}-${idx}-${att.name}`}
                          className="relative"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  'relative border rounded-xl size-14 overflow-hidden',
                                  'flex items-center justify-center',
                                  showAttachmentLoader &&
                                    'ring-1 ring-primary/30 bg-muted/40'
                                )}
                              >
                                {att.dataUrl ? (
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
                                {showAttachmentLoader && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                                    <IconLoader2
                                      size={18}
                                      className="animate-spin text-primary"
                                    />
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
                                  {att.mimeType || 'image'}
                                  {att.size
                                    ? ` · ${formatBytes(att.size)}`
                                    : ''}
                                </div>
                                {showAttachmentLoader && (
                                  <div className="opacity-70 mt-1">
                                    Preparing attachment...
                                  </div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>

                          {!showAttachmentLoader && (
                            <div
                              className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                              onClick={() => handleRemoveAttachment(idx)}
                            >
                              <IconX className="text-neutral-200" size={14} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
                {embeddingModelStatusText && (
                  <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <IconLoader2 size={14} className="animate-spin shrink-0" />
                    <span className="truncate">{embeddingModelStatusText}</span>
                  </div>
                )}
              </div>
            )}
            <TextareaAutosize
              dir="auto"
              ref={textareaRef}
              minRows={2}
              rows={1}
              maxRows={10}
              value={prompt}
              data-testid={'chat-input'}
              onChange={(e) => {
                setPrompt(e.target.value)
                // Count the number of newlines to estimate rows
                const newRows = (e.target.value.match(/\n/g) || []).length + 1
                setRows(Math.min(newRows, maxRows))
              }}
              onKeyDown={(e) => {
                // e.keyCode 229 is for IME input with Safari
                const isComposing =
                  e.nativeEvent.isComposing || e.keyCode === 229
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  // Submit prompt when the following conditions are met:
                  // - Enter is pressed without Shift
                  // - The streaming content has finished
                  // - Prompt is not empty
                  if (
                    !isStreaming &&
                    prompt.trim() &&
                    !isAttachmentPipelineBusy &&
                    !blockSendUntilModelReady
                  ) {
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
                'bg-transparent pt-4 w-full shrink-0 border-none resize-none outline-0 px-4',
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
                  isStreaming && 'opacity-50 pointer-events-none'
                )}
              >
                {/* Dropdown for attachments — hidden in agent mode */}
                {!effectiveAgentMode && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        className="rounded-full mr-2 mb-1"
                      >
                        <PlusIcon
                          size={18}
                          className="text-secondary-foreground"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {/* Vision image attachment - always enabled, prompts to download vision model if needed */}
                      <DropdownMenuItem onClick={handleImagePickerClick}>
                        <IconPhoto
                          size={18}
                          className="text-muted-foreground"
                        />
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
                        disabled={
                          !selectedModel?.capabilities?.includes('tools')
                        }
                      >
                        {ingestingDocs ? (
                          <IconLoader2
                            size={18}
                            className="text-muted-foreground animate-spin"
                          />
                        ) : (
                          <IconPaperclip
                            size={18}
                            className="text-muted-foreground"
                          />
                        )}
                        <span>
                          {ingestingDocs
                            ? 'Indexing documents…'
                            : 'Add documents or files'}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* {model?.provider === 'llamacpp' && loadingModel ? (
                  <ModelLoader />
                ) : (
                  <DropdownModelProvider
                    model={model}
                    useLastUsedModel={initialMessage}
                  />
                )} */}
                {/* //! Кнопка Browse (Chrome) — временно скрыта
                {!effectiveAgentMode && hasJanBrowserMCPConfig && modelSupportsBrowser && (
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
                */}

                {!effectiveAgentMode &&
                  selectedModel?.capabilities?.includes('embeddings') && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-xs">
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

                {!effectiveAgentMode &&
                  selectedModel?.capabilities?.includes('tools') &&
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
                    <Tooltip
                      open={tooltipToolsAvailable}
                      onOpenChange={setTooltipToolsAvailable}
                    >
                      <TooltipTrigger asChild disabled={dropdownToolsAvailable}>
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
                                    'p-1 flex items-center justify-center rounded-sm transition-all duration-200 ease-in-out gap-1 cursor-pointer'
                                  )}
                                >
                                  <IconTool
                                    size={18}
                                    className={cn('text-muted-foreground')}
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

                <ReasoningToggle />

                {/* Agent mode toggle hidden — kept as dead code for future use */}
                {false && !projectId && isAgentMode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isAgentMode ? 'default' : 'ghost'}
                        size="icon-xs"
                        onClick={
                          currentThreadId ? handleAgentToggle : undefined
                        }
                        className={cn(
                          isAgentMode &&
                            'text-primary bg-primary/10 hover:bg-primary/10 items-center',
                          !currentThreadId &&
                            'cursor-default pointer-events-none'
                        )}
                      >
                        <BotIcon
                          className={cn(
                            'text-muted-foreground -mt-0.5',
                            isAgentMode && 'text-primary'
                          )}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isAgentMode
                          ? 'Agent mode active'
                          : 'Enable agent mode'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}

                {!effectiveAgentMode &&
                  selectedModel?.capabilities?.includes('web_search') && (
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
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedProvider === 'llamacpp' &&
                tokenCounterCompact &&
                !effectiveAgentMode &&
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

              {isStreaming ? (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  className="rounded-full mr-1 mb-1"
                  onClick={() => {
                    if (currentThreadId) stopStreaming(currentThreadId)
                  }}
                >
                  <IconPlayerStopFilled />
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="icon-sm"
                  disabled={
                    !prompt.trim() ||
                    isAttachmentPipelineBusy ||
                    blockSendUntilModelReady
                  }
                  data-test-id="send-message-button"
                  onClick={() => handleSendMessage(prompt)}
                  className="rounded-full mr-1 mb-1"
                >
                  <ArrowRight className="text-primary-fg" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="-mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-muted-foreground cursor-pointer"
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
        isModelActive &&
        !effectiveAgentMode &&
        !tokenCounterCompact &&
        !initialMessage &&
        (threadMessages?.length > 0 || prompt.trim().length > 0) && (
          <div className="flex-1 w-full flex justify-start px-2">
            <TokenCounter
              messages={threadMessages || []}
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

      {/* Vision Model Download Prompt */}
      <PromptVisionModel
        open={showVisionModelPrompt}
        onClose={() => setShowVisionModelPrompt(false)}
        onDownloadComplete={handleVisionModelDownloadComplete}
      />
    </div>
  )
})

export default ChatInput

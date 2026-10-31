import TextareaAutosize from 'react-textarea-autosize'
import { cn, formatBytes } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import type { ReactNode } from 'react'
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
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { ArrowRight, PlusIcon, SlidersHorizontal, UserRound } from 'lucide-react'
import {
  IconPhoto,
  IconMusic,
  IconVideo,
  IconTool,
  IconPlayerStopFilled,
  IconX,
  IconPaperclip,
  IconLoader2,
  IconWorldSearch,
  IconTerminal2,
  IconBrandChrome,
} from '@tabler/icons-react'
import { generateId } from 'ai'
import { useMessageQueue } from '@/stores/message-queue-store'
import { QueuedMessageChip } from '@/containers/QueuedMessageBubble'
import { SamplerPopover } from '@/containers/SamplerPopover'
import ComposerModelPicker from '@/containers/ComposerModelPicker'
import { AssistantsMenu } from '@/components/AssistantsMenu'
import { useAssistantSwitcher } from '@/hooks/useAssistantSwitcher'
import { useToolAvailable, createToolKey } from '@/hooks/useToolAvailable'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useReconcileVideoCapability } from '@/hooks/useReconcileVideoCapability'

import { useAppState } from '@/hooks/useAppState'
import { MovingBorder } from './MovingBorder'
import type { ChatStatus } from 'ai'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  TEMPORARY_CHAT_ID,
  TEMPORARY_CHAT_QUERY_ID,
  SESSION_STORAGE_KEY,
  SESSION_STORAGE_PREFIX,
} from '@/constants/chat'
import { defaultModel } from '@/lib/models'
import { cancelAgentThreadBash, getSandboxStatus } from '@/lib/agentTools'
import { useChatShell } from '@/hooks/useChatShell'
import { useAssistant } from '@/hooks/useAssistant'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTools } from '@/hooks/useTools'
import { TokenCounter } from '@/components/TokenCounter'
import type { TokenUsageSource } from '@/hooks/useTokensCount'
import { useMessages } from '@/hooks/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { McpExtensionToolLoader } from './McpExtensionToolLoader'
import {
  ExtensionTypeEnum,
  MCPExtension,
  fs,
  VectorDBExtension,
} from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { useAttachments } from '@/hooks/useAttachments'
import { useImageAttachmentConfig } from '@/hooks/useImageAttachmentConfig'
import { toast } from 'sonner'
import { isPlatformTauri } from '@/lib/platform/utils'
import { shouldShowTokenCounter } from '@/lib/tokenCounterVisibility'
import { isPredefinedRemoteProvider } from '@/lib/providerCaps'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'

import {
  Attachment,
  createImageAttachment,
  createDocumentAttachment,
  createAudioAttachment,
  createVideoAttachment,
} from '@/types/attachment'
import {
  applyIngestionChoices,
  needsIngestionChoice,
  parseModeForModel,
  promptIngestionChoices,
  resolveAutoInlineBudget,
} from '@/lib/attachmentProcessing'
import { activePathTokens } from '@/lib/message-branching'
import JanBrowserExtensionDialog from '@/containers/dialogs/JanBrowserExtensionDialog'
import { useJanBrowserExtension } from '@/hooks/useJanBrowserExtension'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import {
  expandPromptReferences,
  searchFiles,
  type FilePickerEntry as FileEntry,
} from '@/lib/path-references'
import { FilePickerPopover } from '@/components/FilePickerPopover'
type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  onModelChange?: (model: ThreadModel) => void
  menuWorkspace?: ReactNode
  menuControls?: ReactNode
  initialMessage?: boolean
  projectId?: string
  projectAssistantId?: string
  /** Whether this surface applies assistant instructions and selection. */
  supportsAssistants?: boolean
  onSubmit?: (
    text: string,
    files?: Array<{ type: 'file'; mediaType: string; url: string }>,
    /** Document attachments, for surfaces that do not read them back out of
     * the attachments store themselves. */
    documents?: Attachment[],
    /** What the user typed, before @path references were expanded into
     * `text`, so a cancelled send can hand it back unchanged. */
    draft?: string
  ) => void | boolean | Promise<void | boolean>
  onStop?: () => void
  chatStatus?: ChatStatus
  /**
   * The turn's tools are still running or awaiting approval after the stream
   * ended (`chatStatus` is already `ready`). Stop must stay reachable then: a
   * runaway command otherwise leaves a send arrow and no way to end it. Like
   * `chatStatus`, it queues what the user types until the turn ends.
   */
  toolsRunning?: boolean
  // Overrides the conversation scope this input belongs to — both its message
  // queue and its pending attachments (default: useThreads' currentThreadId).
  // Callers outside the general chat (e.g. Cowork, keyed by session id) pass
  // their own id so each gets an independent queue and attachment draft.
  scopeKey?: string
  /**
   * Whether the surface's tool set is configured from this composer.
   *
   * False for a surface that builds its own set (Cowork, via
   * `buildCoworkTools`). Its toggles here would be inert on this surface while
   * still writing the global chat stores, so a user turning "agent tools" off
   * in Cowork would silently disable them in Chat.
   */
  ownsToolSet?: boolean
  /**
   * Surface-specific controls docked in the composer's control row (Cowork's
   * plan toggle and folder chip). They sit outside the streaming dim, because
   * both configure the *next* message rather than the run in flight.
   */
  /** Controls placed immediately after the attachment button (home mode selector). */
  leadingControls?: ReactNode
  surfaceControls?: ReactNode
  /**
   * Usage for a surface that keeps no thread messages (Cowork). Rendering the
   * counter here rather than in the caller is what keeps its placement, the
   * `tokenCounterCompact` setting and the spacing to the send button identical
   * across surfaces.
   */
  tokenSource?: TokenUsageSource
  highlightedPrefix?: string | null
}

// Video containers llama-server can decode via ffmpeg/ffprobe into frames.
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']
const videoMimeForExt = (ext: string | undefined): string => {
  switch (ext) {
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'mkv':
      return 'video/x-matroska'
    case 'avi':
      return 'video/x-msvideo'
    default:
      return 'video/mp4'
  }
}

const ChatInput = memo(function ChatInput({
  className,
  model,
  onModelChange,
  menuWorkspace,
  menuControls,
  initialMessage,
  projectId,
  projectAssistantId,
  supportsAssistants = true,
  onSubmit,
  onStop,
  chatStatus,
  toolsRunning,
  scopeKey,
  ownsToolSet = true,
  surfaceControls,
  leadingControls,
  tokenSource,
  highlightedPrefix,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const [composerWidth, setComposerWidth] = useState(0)
  // Panel animations change the element width without a window resize. The
  // autosizer must remeasure at the settled width, not keep a transient height.
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const width = Math.round(element.getBoundingClientRect().width)
        setComposerWidth((previous) => previous === width ? previous : width)
      })
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])

  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const serviceHub = useServiceHub()
  const abortControllers = useAppState((state) => state.abortControllers)
  const tools = useAppState((state) => state.tools)
  const cancelToolCall = useAppState((state) => state.cancelToolCall)
  const prompt = usePrompt((state) => state.prompt)
  const setPrompt = usePrompt((state) => state.setPrompt)
  const addToHistory = usePrompt((state) => state.addToHistory)
  const navigateHistory = usePrompt((state) => state.navigateHistory)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const currentThread = useThreads((state) => state.getCurrentThread())
  const updateCurrentThreadAssistant = useThreads(
    (state) => state.updateCurrentThreadAssistant
  )
  const { t } = useTranslation()
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  useTools()
  const router = useRouter()
  const createThread = useThreads((state) => state.createThread)
  const { loading, currentAssistant, setCurrentAssistant, assistants, defaultAssistantId } =
    useAssistant()

  // Agent mode
  // Use TEMPORARY_CHAT_ID as fallback key on the home screen (same pattern as attachments)
  const agentModeKey = currentThreadId ?? TEMPORARY_CHAT_ID
  const isAgentMode = useAgentMode(
    (state) => state.agentThreads[agentModeKey] === true
  )
  // When projectId is present, treat as normal chat (disable agent mode UI)
  const effectiveAgentMode = isAgentMode && !projectId
  // Gate for the controls that shape which tools the model is offered.
  const showToolControls = ownsToolSet && !effectiveAgentMode
  const webSearchEnabled = useWebSearchConfig((s) => s.webSearchEnabled)
  const setWebSearchEnabled = useWebSearchConfig((s) => s.setWebSearchEnabled)
  const shellEnabled = useChatShell((s) => s.shellEnabled)
  const setShellEnabled = useChatShell((s) => s.setShellEnabled)
  // The shell is only ever offered where a sandbox can confine it, so the
  // switch is only shown there: with no backend there is nothing to turn off.
  const [sandboxEnforcesShell, setSandboxEnforcesShell] = useState(false)
  useEffect(() => {
    let live = true
    void getSandboxStatus().then((s) => {
      if (live) setSandboxEnforcesShell(s.enforces)
    })
    return () => {
      live = false
    }
  }, [])

  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [filePickerQuery, setFilePickerQuery] = useState('')
  const [filePickerEntries, setFilePickerEntries] = useState<FileEntry[]>([])
  const [filePickerPosition, setFilePickerPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const [workingDir, setWorkingDir] = useState<string | undefined>(undefined)
  // Textarea cursor position snapshot at the time @ was typed
  const filePickerCursorPos = useRef<number | null>(null)

  // Pre-load working directory
  useEffect(() => {
    const loadWorkingDir = async () => {
      try {
        // Try to get project home directory
        const { homeDir } = await import('@tauri-apps/api/path')
        const home = await homeDir()
        setWorkingDir(home)
      } catch {
        setWorkingDir(undefined)
      }
    }
    if (effectiveAgentMode) {
      loadWorkingDir()
    }
  }, [effectiveAgentMode])

  // Detect `@` in the prompt text and open the file picker
  const handlePromptChange = useCallback(
    (value: string) => {
      setPrompt(value)

      // Only enable in agent mode
      if (!effectiveAgentMode) {
        setFilePickerOpen(false)
        return
      }

      const cursorIdx = filePickerCursorPos.current ?? value.length

      // Look backwards from current cursor to find the last word starting with
      // @ (the @ must not be glued to a preceding word char, so `user@host`
      // never opens the picker)
      const beforeCursor = value.slice(0, cursorIdx)
      const atMatch = beforeCursor.match(/(?<![A-Za-z0-9_])@([\w./-]*)$/)

      if (atMatch) {
        const query = atMatch[1] ?? ''
        setFilePickerQuery(query)

        // If we have a working directory, search files
        if (workingDir) {
          searchFiles(workingDir, query)
            .then((entries) => setFilePickerEntries(entries.slice(0, 50)))
            .catch(() => setFilePickerEntries([]))
        } else {
          setFilePickerEntries([])
        }

        // Position the picker above the text
        if (textareaRef.current) {
          const lineHeight = 22
          const lines = beforeCursor.split('\n').length
          const pos = {
            top: -Math.min(lines * lineHeight + 40, 300),
            left: 0,
          }
          setFilePickerPosition(pos)
        }
        setFilePickerOpen(true)
      } else {
        setFilePickerOpen(false)
      }
    },
    [effectiveAgentMode, workingDir, setPrompt]
  )

  // Insert a selected file reference into the prompt
  const handleFilePickerSelect = useCallback(
    (entry: FileEntry) => {
      if (filePickerCursorPos.current == null) return

      const beforeCursor = prompt.slice(0, filePickerCursorPos.current)
      const afterCursor = prompt.slice(filePickerCursorPos.current)

      // Replace the `@query` with `path/to/file` (the resolved reference)
      const textBefore = beforeCursor.replace(/(?<![A-Za-z0-9_])@[\w./-]*$/, '')
      const refText = entry.path
      const newPrompt = textBefore + refText + afterCursor

      setPrompt(newPrompt)
      setFilePickerOpen(false)
      filePickerCursorPos.current = null

      // Focus back on textarea
      setTimeout(() => textareaRef.current?.focus(), 0)
    },
    [prompt, setPrompt]
  )

  const handleFilePickerClose = useCallback(() => {
    setFilePickerOpen(false)
    filePickerCursorPos.current = null
  }, [])

  // Get current thread messages for token counting
  const threadMessages = useMessages(
    useShallow((state) =>
      currentThreadId ? state.messages[currentThreadId] : []
    )
  )

  // Read when a document is attached, without rebuilding the attach
  // callback on every message update.
  const threadMessagesRef = useRef(threadMessages)
  threadMessagesRef.current = threadMessages

  const maxRows = 10

  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const [message, setMessage] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [samplingOpen, setSamplingOpen] = useState(false)
  const optionsTriggerRef = useRef<HTMLButtonElement>(null)
  const assistantMenuOpen = useAssistantSwitcher((state) => state.open)
  const setAssistantMenuOpen = useAssistantSwitcher((state) => state.setOpen)
  const disabledTools = useToolAvailable((state) => state.disabledTools)
  const setToolDisabled = useToolAvailable((state) => state.setToolDisabled)
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipShown, setTooltipShown] = useState<
    'tools' | 'assistants' | false
  >(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasMmproj, setHasMmproj] = useState(false)
  const activeModels = useAppState(useShallow((state) => state.activeModels))
  // Check if selected model is currently loaded/active
  const isModelActive = selectedModel?.id
    ? activeModels.includes(selectedModel.id)
    : false

  // Reconcile video capability from /props once the model is loaded.
  useReconcileVideoCapability(
    selectedModel?.id,
    selectedProvider,
    isModelActive
  )

  const tokenCounterVisible = shouldShowTokenCounter({
    hasSelectedModel: !!selectedModel,
    isAgentMode: effectiveAgentMode,
    isInitialMessage: !!initialMessage,
    hasMessages: (threadMessages?.length ?? 0) > 0,
    hasPromptText: prompt.trim().length > 0,
    hasReportedUsage: (tokenSource?.usage?.totalTokens ?? 0) > 0,
  })
  // Resolve a missing project assignment only while initializing. Once selected,
  // including explicit None, the composer's choice is authoritative at send time.
  const initialAssistantId = assistants.find((a) => a.id === projectAssistantId)?.id
    || assistants.find((a) => a.id === currentAssistant?.id)?.id
    || (projectAssistantId
      ? assistants.find((a) => a.id === defaultAssistantId)?.id || assistants[0]?.id
      : '')
  const selectionKey = JSON.stringify([projectId, projectAssistantId])
  const selectionInitialization = useRef({ key: selectionKey, resolved: !loading })
  const [selectedAssistantId, setSelectedAssistantIdState] = useState<
    string | undefined
  >(loading ? undefined : initialAssistantId)
  const setSelectedAssistantId = useCallback((id: string) => {
    selectionInitialization.current.resolved = true
    setSelectedAssistantIdState(id)
  }, [])

  useEffect(() => {
    if (selectionInitialization.current.key !== selectionKey) {
      selectionInitialization.current = { key: selectionKey, resolved: false }
    }
    if (!loading && !selectionInitialization.current.resolved) {
      selectionInitialization.current.resolved = true
      setSelectedAssistantIdState(initialAssistantId)
    }
  }, [loading, selectionKey, initialAssistantId])

  const assistantCycleRef = useRef<() => void>(() => {})
  assistantCycleRef.current = () => {
    if (!supportsAssistants || assistants.length === 0) return
    const activeId = currentThread
      ? currentThread.assistants?.[0]?.id
      : selectedAssistantId
    const index = assistants.findIndex((assistant) => assistant.id === activeId)
    // None is a real choice, including when only one assistant exists.
    const next = assistants[index + 1]
    if (currentThread) updateCurrentThreadAssistant(next as Assistant)
    else setSelectedAssistantId(next?.id || '')
  }
  useEffect(() => {
    if (!supportsAssistants) return
    useAssistantSwitcher
      .getState()
      .setCycleHandler(() => assistantCycleRef.current())
    return () => {
      useAssistantSwitcher.getState().setCycleHandler(null)
      useAssistantSwitcher.getState().setOpen(false)
    }
  }, [supportsAssistants])
  useEffect(() => {
    if (supportsAssistants && assistantMenuOpen) setOptionsOpen(true)
  }, [assistantMenuOpen, supportsAssistants])

  // Jan Browser Extension hook
  const {
    hasConfig: hasJanBrowserMCPConfig,
    isActive: janBrowserMCPActive,
    isLoading: isJanBrowserMCPLoading,
    dialogOpen: extensionDialogOpen,
    dialogState: extensionDialogState,
    toggleBrowser: handleBrowseClick,
    disableDueToIncompatibleModel,
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
      disableDueToIncompatibleModel()
    }
    // disableDueToIncompatibleModel omitted: its !isActive guard makes stale closures safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [janBrowserMCPActive, modelSupportsBrowser])

  const attachmentsEnabled = useAttachments((s) => s.enabled)
  const parsePreference = useAttachments((s) => s.parseMode)
  const autoInlineContextRatio = useAttachments((s) => s.autoInlineContextRatio)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)
  const maxImageSizeMB = useImageAttachmentConfig((s) => s.maxImageSizeMB)

  // Derived: any document currently processing (ingestion in progress)
  // Same scope as the message queue: a surface writing attachments under its
  // own id would have them silently dropped if this read a thread id.
  const attachmentsKey =
    scopeKey ?? currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
  const attachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const transferAttachments = useChatAttachments(
    (state) => state.transferAttachments
  )

  const ingestingDocs = attachments.some(
    (a) => a.type === 'document' && a.processing
  )
  const ingestingAny = attachments.some((a) => a.processing)
  const hasSendableMedia = attachments.some(
    (a) =>
      (a.type === 'image' || a.type === 'audio' || a.type === 'video') &&
      !!a.dataUrl
  )

  const [, setFileIngestProgress] = useState<{
    completed: number
    total: number
  } | null>(null)

  // Queued messages for this thread (shown as chips in the input area)
  const queueId = scopeKey ?? currentThreadId ?? ''
  const queuedMessages = useMessageQueue(useShallow((s) => s.getQueue(queueId)))
  const queueLength = queuedMessages.length

  const removeQueuedMessage = useCallback(
    (id: string) => {
      useMessageQueue.getState().removeMessage(queueId, id)
    },
    [queueId]
  )

  const lastTransferredThreadId = useRef<string | null>(null)

  useEffect(() => {
    // Only the general chat migrates a draft: it composes under the "new
    // thread" key until the thread exists. A scopeKey caller has a stable id
    // from the start, so there is nothing to move.
    if (scopeKey) return
    if (
      currentThreadId &&
      lastTransferredThreadId.current !== currentThreadId
    ) {
      transferAttachments(NEW_THREAD_ATTACHMENT_KEY, currentThreadId)
      lastTransferredThreadId.current = currentThreadId
    }
  }, [scopeKey, currentThreadId, transferAttachments])

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

  const availableMcpTools = tools.filter(
    (tool) => tool.server !== 'Jan Browser MCP'
  )
  const enabledMcpTools = availableMcpTools.filter(
    (tool) => !disabledTools.includes(createToolKey(tool.server, tool.name))
  )
  const toolsByServer = availableMcpTools.reduce<Record<string, typeof tools>>(
    (groups, tool) => {
      const serverTools = (groups[tool.server] ??= [])
      serverTools.push(tool)
      return groups
    },
    {}
  )

  // Get MCP extension and its custom component
  const extensionManager = ExtensionManager.getInstance()
  const mcpExtension = extensionManager.get<MCPExtension>(ExtensionTypeEnum.MCP)
  const MCPToolComponent = mcpExtension?.getToolComponent?.()

  const handleSendMessage = async (prompt: string) => {
    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }

    // Expand @path references that resolve to a file or folder; any other
    // `@token` (a pasted decorator) stays in the text as typed.
    const { text: resolvedText, resolvedContents } =
      await expandPromptReferences(prompt, workingDir)
    const effectivePrompt = resolvedContents
      ? `${resolvedText}\n\n---\nReferenced file contents:\n\n${resolvedContents}`
      : resolvedText

    if (!effectivePrompt.trim() && !hasSendableMedia) {
      return
    }
    if (ingestingAny) {
      toast.info('Please wait for attachments to finish processing')
      return
    }

    setMessage('')
    addToHistory(effectivePrompt)

    // Use onSubmit prop if available (AI SDK), otherwise create thread and navigate
    if (onSubmit) {
      // While the model is still streaming, or the turn's tools are still
      // running, queue the message for later. The queue waits for the tools, so
      // a second turn never starts under a tool loop that Stop still has to end.
      if ((isStreaming || toolsRunning) && queueId) {
        useMessageQueue.getState().enqueue(queueId, {
          id: generateId(),
          text: effectivePrompt,
          createdAt: Date.now(),
        })
        setPrompt('')
        return
      }

      const imageFiles = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file' as const,
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))
      const audioFiles = attachments
        .filter((att) => att.type === 'audio' && att.dataUrl)
        .map((att) => ({
          type: 'file' as const,
          mediaType: att.audioFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
          url: att.dataUrl!,
        }))
      const videoFiles = attachments
        .filter((att) => att.type === 'video' && att.dataUrl)
        .map((att) => ({
          type: 'file' as const,
          mediaType: att.mimeType ?? 'video/mp4',
          url: att.dataUrl!,
        }))
      const files = [...imageFiles, ...audioFiles, ...videoFiles]
      const documents = attachments.filter(
        (att) => att.type === 'document' && att.path
      )

      const accepted = await onSubmit(
        effectivePrompt,
        files.length > 0 ? files : undefined,
        documents.length > 0 ? documents : undefined,
        prompt
      )
      if (accepted === false) return
      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
    } else {
      // No onSubmit provided - create a new thread and navigate to it.
      // Media attachments (image/audio/video) are NOT serialized into
      // sessionStorage — their base64 data URLs blow past the ~5MB quota
      // (esp. video). They live in the in-memory attachments store and are
      // transferred to the new thread's key on the detail page (see the
      // transferAttachments effect); processAndSendMessage reads them there.
      const isTemporaryChat = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      const messagePayload = {
        text: effectivePrompt,
        draft: prompt,
        files: [] as Array<{ type: string; mediaType: string; url: string }>,
      }

      if (isTemporaryChat) {
        // For temporary chat, store message and navigate to temporary thread
        sessionStorage.setItem(
          SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY,
          JSON.stringify(messagePayload)
        )
        sessionStorage.setItem('temp-chat-nav', 'true')
        // Transfer agent mode from home screen to temporary thread
        if (effectiveAgentMode && agentModeKey !== TEMPORARY_CHAT_ID) {
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
            }
          } catch (e) {
            console.warn('Failed to fetch project metadata:', e)
          }
        }

        const assistant = supportsAssistants
          ? assistants.find((a) => a.id === selectedAssistantId)
          : undefined

        setCurrentAssistant(assistant)

        const newThread = await createThread(
          {
            id: selectedModel?.id ?? defaultModel(selectedProvider),
            provider: selectedProvider,
          },
          prompt, // Use prompt as thread title
          assistant,
          projectMetadata
        )

        // Transfer agent mode from home screen to the new thread
        if (effectiveAgentMode) {
          useAgentMode.getState().setAgentMode(newThread.id, true)
          useAgentMode.getState().removeThread(agentModeKey)
        }

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
      // Don't clear attachments here — document attachments stored under
      // NEW_THREAD_ATTACHMENT_KEY need to survive until the thread detail
      // page transfers and processes them.  The thread detail page's
      // processAndSendMessage already calls clearAttachmentsForThread after
      // processing is complete.
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
    if (tooltipShown && dropdownToolsAvailable) {
      setTooltipShown(false)
    }
  }, [dropdownToolsAvailable, tooltipShown])

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
      // Aborting the stream/loop only discards a pending tool result; a running
      // or backgrounded shell keeps executing until its session's shells are
      // killed. Chat's tool thread_id is the chat thread id.
      void cancelAgentThreadBash(threadId)
    },
    [abortControllers, cancelToolCall, onStop]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const audioSupported = !!selectedModel?.capabilities?.includes('audio')
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoSupported = !!selectedModel?.capabilities?.includes('video')

  const processNewDocumentAttachments = useCallback(
    async (docs: Attachment[]) => {
      if (!docs.length) return

      // Only collect the user's inline-vs-embeddings preference via the
      // dialog.  Actual ingestion is always deferred to send time
      // (processAttachmentsForSend inside processAndSendMessage), where
      // 'auto' documents are routed by size when the model's window is known.
      // Same conversation-aware budget as the send path (the active branch,
      // which is what gets sent). If the budget is gone by send time, the
      // send path asks for the remaining 'auto' documents itself.
      const hasInlineBudget =
        (await resolveAutoInlineBudget(
          selectedModel,
          selectedProvider,
          autoInlineContextRatio,
          activePathTokens(
            threadMessagesRef.current,
            (
              useThreads.getState().threads[currentThreadId ?? '']?.metadata as
                | Record<string, unknown>
                | undefined
            )?.activeRootId as string | undefined
          )
        )) !== undefined
      const docsNeedingPrompt = docs.filter((doc) =>
        needsIngestionChoice(doc, parsePreference, hasInlineBudget)
      )

      if (docsNeedingPrompt.length > 0) {
        const choices = await promptIngestionChoices(docsNeedingPrompt)

        if (!choices) {
          // User cancelled — remove all pending docs
          setAttachmentsForThread(attachmentsKey, (prev) =>
            prev.filter(
              (att) =>
                !docsNeedingPrompt.some(
                  (d) => d.path && att.path && d.path === att.path
                )
            )
          )
          return
        }

        // Persist each document's chosen mode so processAttachmentsForSend
        // can pick it up at send time.
        if (choices.size > 0) {
          setAttachmentsForThread(attachmentsKey, (prev) =>
            applyIngestionChoices(prev, choices)
          )
        }
      }
    },
    [
      attachmentsKey,
      autoInlineContextRatio,
      currentThreadId,
      parsePreference,
      selectedModel,
      selectedProvider,
      setAttachmentsForThread,
    ]
  )

  const handleAttachDocsIngest = async () => {
    try {
      if (!attachmentsEnabled) {
        toast.info('Attachments are disabled in Settings')
        return
      }
      const selection = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Documents & Code',
            extensions: [
              // Documents
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
              // JavaScript / TypeScript
              'js',
              'mjs',
              'cjs',
              'ts',
              'mts',
              'cts',
              'jsx',
              'tsx',
              // Python
              'py',
              'pyw',
              'pyi',
              // C / C++
              'c',
              'h',
              'cpp',
              'cc',
              'cxx',
              'hpp',
              'hh',
              // Systems languages
              'rs',
              'go',
              'swift',
              'zig',
              // JVM languages
              'java',
              'kt',
              'kts',
              'scala',
              'groovy',
              // Scripting languages
              'rb',
              'php',
              'lua',
              'pl',
              'r',
              'jl',
              // .NET
              'cs',
              'fs',
              'vb',
              'xaml',
              'csproj',
              'sln',
              // CUDA
              'cu',
              'cuh',
              // Shaders
              'hlsl',
              'glsl',
              'cg',
              'shader',
              // Shell
              'sh',
              'bash',
              'zsh',
              'fish',
              'ps1',
              'bat',
              'cmd',
              'vbs',
              // More languages
              'asm',
              's',
              'm',
              'mm',
              'pas',
              'pp',
              'erl',
              'hrl',
              'ex',
              'exs',
              'clj',
              'cljs',
              'hs',
              'lhs',
              'ml',
              'mli',
              'f',
              'f90',
              // Web
              'css',
              'scss',
              'sass',
              'less',
              'vue',
              'svelte',
              'astro',
              'php',
              'asp',
              'aspx',
              'jsp',
              // Data / config formats
              'json',
              'jsonc',
              'yaml',
              'yml',
              'toml',
              'xml',
              'ini',
              'cfg',
              'conf',
              'env',
              'properties',
              'dockerfile',
              'makefile',
              'cmake',
              'lock',
              // Query / markup
              'sql',
              'graphql',
              'gql',
              'tex',
              'rst',
              'adoc',
              'textile',
              // Misc text
              'log',
              'diff',
              'patch',
              'gitignore',
            ],
          },
          {
            name: 'All Files',
            extensions: ['*'],
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      if (!paths.length) return

      const modelSupportsTools =
        !!selectedModel?.capabilities?.includes('tools')

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
            parseMode: parseModeForModel(parsePreference, modelSupportsTools),
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
        if (!modelSupportsTools) {
          toast.info('Documents are added to the prompt', {
            description:
              "This model can't search files, so each document is sent as text with your message.",
          })
        }
        await processNewDocumentAttachments(newDocAttachments)
      }
    } catch (e) {
      console.error('Failed to attach documents:', e)
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

  const hashBase64 = async (base64: string): Promise<string> => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const processImageFiles = useCallback(
    async (files: File[]) => {
      const maxSize = maxImageSizeMB * 1024 * 1024
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

      // Compute content hashes for deduplication (allows different images with same filename)
      for (const att of preparedFiles) {
        if (att.base64) {
          att.contentHash = await hashBase64(att.base64)
        }
      }

      const duplicates: string[] = []
      const newFiles: Attachment[] = []

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

      const seenHashesInBatch = new Set<string>()
      for (const att of preparedFiles) {
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

      // Cowork keys attachments by session id (`scopeKey`) and sends them as
      // data URLs on submit. Ingesting against a leftover chat `currentThreadId`
      // can fail and strip the chip we just added.
      if (!scopeKey && currentThreadId && newFiles.length > 0) {
        const ingestTotal = newFiles.length
        void (async () => {
          setFileIngestProgress({ completed: 0, total: ingestTotal })
          try {
            for (let i = 0; i < newFiles.length; i++) {
              const img = newFiles[i]
              const matchImg = (a: Attachment) =>
                a.type === 'image' &&
                (img.contentHash
                  ? a.contentHash === img.contentHash
                  : a.name === img.name)

              try {
                setAttachmentsForThread(attachmentsKey, (prev) =>
                  prev.map((a) =>
                    matchImg(a) ? { ...a, processing: true } : a
                  )
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
              } finally {
                setFileIngestProgress({
                  completed: i + 1,
                  total: ingestTotal,
                })
              }
            }
          } finally {
            setFileIngestProgress(null)
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
          `File${oversizedFiles.length > 1 ? 's' : ''} too large (max ${maxImageSizeMB}MB): ${oversizedFiles.join(', ')}`
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
    },
    [
      attachmentsKey,
      currentThreadId,
      scopeKey,
      setAttachmentsForThread,
      serviceHub,
      setFileIngestProgress,
      maxImageSizeMB,
    ]
  )

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files

    if (files && files.length > 0) {
      void processImageFiles(Array.from(files))

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  const decodeAudioDuration = (dataUrl: string): Promise<number | undefined> =>
    new Promise((resolve) => {
      try {
        const audio = new Audio()
        audio.preload = 'metadata'
        audio.onloadedmetadata = () => {
          const d = audio.duration
          resolve(Number.isFinite(d) && d > 0 ? d : undefined)
        }
        audio.onerror = () => resolve(undefined)
        audio.src = dataUrl
      } catch {
        resolve(undefined)
      }
    })

  const processAudioFiles = useCallback(
    async (files: File[]) => {
      const maxBytes = 25 * 1024 * 1024
      const oversized: string[] = []
      const invalid: string[] = []
      const prepared: Attachment[] = []

      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase()
        const ext = lower.split('.').pop()
        const isWav =
          file.type === 'audio/wav' ||
          file.type === 'audio/x-wav' ||
          ext === 'wav'
        const isMp3 =
          file.type === 'audio/mpeg' ||
          file.type === 'audio/mp3' ||
          ext === 'mp3'
        if (!isWav && !isMp3) {
          invalid.push(file.name)
          continue
        }
        if (file.size > maxBytes) {
          oversized.push(file.name)
          continue
        }
        const fmt: 'wav' | 'mp3' = isWav ? 'wav' : 'mp3'
        const mimeType = fmt === 'wav' ? 'audio/wav' : 'audio/mpeg'
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const r = reader.result
            if (typeof r === 'string') resolve(r)
            else reject(new Error('read failed'))
          }
          reader.onerror = () =>
            reject(reader.error ?? new Error('read failed'))
          reader.readAsDataURL(file)
        })
        const base64 = dataUrl.split(',')[1] ?? ''
        const durationSec = await decodeAudioDuration(dataUrl)
        prepared.push(
          createAudioAttachment({
            name: file.name,
            base64,
            dataUrl,
            mimeType,
            audioFormat: fmt,
            size: file.size,
            durationSec,
          })
        )
      }

      const current = useChatAttachments
        .getState()
        .getAttachments(attachmentsKey)
      const existingNames = new Set(
        current.filter((a) => a.type === 'audio').map((a) => a.name)
      )
      const duplicates: string[] = []
      const newOnes: Attachment[] = []
      for (const att of prepared) {
        if (existingNames.has(att.name)) {
          duplicates.push(att.name)
          continue
        }
        newOnes.push(att)
      }

      if (newOnes.length > 0) {
        setAttachmentsForThread(attachmentsKey, (prev) => [...prev, ...newOnes])
      }

      if (duplicates.length > 0) {
        toast.warning('Some audio files already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }
      const errors: string[] = []
      if (oversized.length > 0) {
        errors.push(
          `Audio file${oversized.length > 1 ? 's' : ''} too large (max 25MB): ${oversized.join(', ')}`
        )
      }
      if (invalid.length > 0) {
        errors.push(
          `Invalid audio type${invalid.length > 1 ? 's' : ''} (only WAV, MP3 allowed): ${invalid.join(', ')}`
        )
      }
      if (errors.length > 0) {
        setMessage(errors.join(' | '))
        if (audioInputRef.current) audioInputRef.current.value = ''
      }
    },
    [attachmentsKey, setAttachmentsForThread]
  )

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      void processAudioFiles(Array.from(files))
      if (audioInputRef.current) audioInputRef.current.value = ''
    }
    if (textareaRef.current) textareaRef.current.focus()
  }

  const openAudioPicker = useCallback(async () => {
    if (isPlatformTauri()) {
      try {
        const selected = await serviceHub.dialog().open({
          multiple: true,
          filters: [{ name: 'Audio', extensions: ['wav', 'mp3'] }],
        })
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected]
          const files: File[] = []
          for (const path of paths) {
            try {
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const fileUrl = convertFileSrc(path)
              const response = await fetch(fileUrl)
              if (!response.ok) throw new Error(response.statusText)
              const blob = await response.blob()
              const fileName =
                path.split(/[\\/]/).filter(Boolean).pop() || 'audio'
              const ext = fileName.toLowerCase().split('.').pop()
              const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'
              files.push(new File([blob], fileName, { type: mimeType }))
            } catch (error) {
              console.error('Failed to read audio file:', error)
              toast.error('Failed to read audio file', {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }
          if (files.length > 0) await processAudioFiles(files)
        }
      } catch (error) {
        console.error('Failed to open audio dialog:', error)
      }
      if (textareaRef.current) textareaRef.current.focus()
    } else {
      audioInputRef.current?.click()
    }
  }, [serviceHub, processAudioFiles])

  const processVideoFiles = useCallback(
    async (files: File[]) => {
      const maxBytes = 100 * 1024 * 1024
      const oversized: string[] = []
      const invalid: string[] = []
      const prepared: Attachment[] = []

      for (const file of Array.from(files)) {
        const ext = file.name.toLowerCase().split('.').pop()
        const isVideo =
          file.type.startsWith('video/') || VIDEO_EXTS.includes(ext ?? '')
        if (!isVideo) {
          invalid.push(file.name)
          continue
        }
        if (file.size > maxBytes) {
          oversized.push(file.name)
          continue
        }
        const mimeType = file.type.startsWith('video/')
          ? file.type
          : videoMimeForExt(ext)
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const r = reader.result
            if (typeof r === 'string') resolve(r)
            else reject(new Error('read failed'))
          }
          reader.onerror = () =>
            reject(reader.error ?? new Error('read failed'))
          reader.readAsDataURL(file)
        })
        const base64 = dataUrl.split(',')[1] ?? ''
        prepared.push(
          createVideoAttachment({
            name: file.name,
            base64,
            dataUrl,
            mimeType,
            size: file.size,
          })
        )
      }

      const current = useChatAttachments
        .getState()
        .getAttachments(attachmentsKey)
      const existingNames = new Set(
        current.filter((a) => a.type === 'video').map((a) => a.name)
      )
      const duplicates: string[] = []
      const newOnes: Attachment[] = []
      for (const att of prepared) {
        if (existingNames.has(att.name)) {
          duplicates.push(att.name)
          continue
        }
        newOnes.push(att)
      }

      if (newOnes.length > 0) {
        setAttachmentsForThread(attachmentsKey, (prev) => [...prev, ...newOnes])
      }

      if (duplicates.length > 0) {
        toast.warning('Some video files already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }
      const errors: string[] = []
      if (oversized.length > 0) {
        errors.push(
          `Video file${oversized.length > 1 ? 's' : ''} too large (max 100MB): ${oversized.join(', ')}`
        )
      }
      if (invalid.length > 0) {
        errors.push(
          `Invalid video type${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`
        )
      }
      if (errors.length > 0) {
        setMessage(errors.join(' | '))
        if (videoInputRef.current) videoInputRef.current.value = ''
      }
    },
    [attachmentsKey, setAttachmentsForThread]
  )

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      void processVideoFiles(Array.from(files))
      if (videoInputRef.current) videoInputRef.current.value = ''
    }
    if (textareaRef.current) textareaRef.current.focus()
  }

  const openVideoPicker = useCallback(async () => {
    if (isPlatformTauri()) {
      try {
        const selected = await serviceHub.dialog().open({
          multiple: true,
          filters: [{ name: 'Video', extensions: VIDEO_EXTS }],
        })
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected]
          const files: File[] = []
          for (const path of paths) {
            try {
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const fileUrl = convertFileSrc(path)
              const response = await fetch(fileUrl)
              if (!response.ok) throw new Error(response.statusText)
              const blob = await response.blob()
              const fileName =
                path.split(/[\\/]/).filter(Boolean).pop() || 'video'
              const ext = fileName.toLowerCase().split('.').pop()
              files.push(
                new File([blob], fileName, { type: videoMimeForExt(ext) })
              )
            } catch (error) {
              console.error('Failed to read video file:', error)
              toast.error('Failed to read video file', {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }
          if (files.length > 0) await processVideoFiles(files)
        }
      } catch (error) {
        console.error('Failed to open video dialog:', error)
      }
      if (textareaRef.current) textareaRef.current.focus()
    } else {
      videoInputRef.current?.click()
    }
  }, [serviceHub, processVideoFiles])

  // Open the image picker dialog (extracted for reuse)
  const openImagePicker = useCallback(async () => {
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
  }, [serviceHub, processImageFiles])

  const dropAcceptsAnything = hasMmproj || audioSupported || videoSupported

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dropAcceptsAnything) {
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
    if (dropAcceptsAnything) {
      setIsDragOver(true)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!dropAcceptsAnything) return
    if (!e.dataTransfer) {
      console.warn('No dataTransfer available in drop event')
      return
    }

    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length === 0) return

    const isAudioFile = (f: File) => {
      const ext = f.name.toLowerCase().split('.').pop()
      return (
        f.type === 'audio/wav' ||
        f.type === 'audio/x-wav' ||
        f.type === 'audio/mpeg' ||
        f.type === 'audio/mp3' ||
        ext === 'wav' ||
        ext === 'mp3'
      )
    }

    const isVideoFile = (f: File) => {
      const ext = f.name.toLowerCase().split('.').pop()
      return f.type.startsWith('video/') || VIDEO_EXTS.includes(ext ?? '')
    }

    const audioOnes = audioSupported ? dropped.filter(isAudioFile) : []
    const videoOnes = videoSupported ? dropped.filter(isVideoFile) : []
    const otherOnes = dropped.filter(
      (f) => !audioOnes.includes(f) && !videoOnes.includes(f)
    )

    if (otherOnes.length > 0 && hasMmproj) {
      const dt = new DataTransfer()
      otherOnes.forEach((f) => dt.items.add(f))
      const syntheticEvent = {
        target: { files: dt.files },
      } as React.ChangeEvent<HTMLInputElement>
      handleFileChange(syntheticEvent)
    }
    if (audioOnes.length > 0) {
      void processAudioFiles(audioOnes)
    }
    if (videoOnes.length > 0) {
      void processVideoFiles(videoOnes)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (audioSupported) {
      const clipboardItems = e.clipboardData?.items
      if (clipboardItems && clipboardItems.length > 0) {
        const audioFiles: File[] = []
        for (const item of Array.from(clipboardItems)) {
          if (
            item.type === 'audio/wav' ||
            item.type === 'audio/x-wav' ||
            item.type === 'audio/mpeg' ||
            item.type === 'audio/mp3'
          ) {
            const f = item.getAsFile()
            if (f) audioFiles.push(f)
          }
        }
        if (audioFiles.length > 0) {
          e.preventDefault()
          await processAudioFiles(audioFiles)
          return
        }
      }
    }

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
    <div className="@container/composer relative">
      <div className="relative">
        <div className={cn('relative overflow-hidden rounded-3xl')}>
          {isStreaming && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] border-2 border-transparent motion-reduce:hidden"
              style={{
                mask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
                maskComposite: 'exclude',
              }}
            >
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
              'relative z-20 px-0 border rounded-3xl border-input bg-white dark:bg-input/30 transition-[border-color,box-shadow] duration-200 ease-out',
              // Keep focus a quiet single-pixel edge on the white composer;
              // the global ring token is too dark for this large outline.
              isFocused && 'border-black/20 dark:border-ring/60',
              isDragOver && 'ring-2 ring-ring/50 border-primary'
            )}
            data-drop-zone={dropAcceptsAnything ? 'true' : undefined}
            onDragEnter={dropAcceptsAnything ? handleDragEnter : undefined}
            onDragLeave={dropAcceptsAnything ? handleDragLeave : undefined}
            onDragOver={dropAcceptsAnything ? handleDragOver : undefined}
            onDrop={dropAcceptsAnything ? handleDrop : undefined}
          >
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 p-2 pb-0">
                <div className="flex gap-3 items-center">
                  {attachments
                    .map((att, idx) => ({ att, idx }))
                    .map(({ att, idx }) => {
                      const isImage = att.type === 'image'
                      const isAudio = att.type === 'audio'
                      const isVideo = att.type === 'video'
                      const ext = att.fileType || att.mimeType?.split('/')[1]
                      const durLabel =
                        isAudio && typeof att.durationSec === 'number'
                          ? `${Math.floor(att.durationSec / 60)}:${Math.floor(
                              att.durationSec % 60
                            )
                              .toString()
                              .padStart(2, '0')}`
                          : undefined
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
                                  'flex items-center justify-center'
                                )}
                              >
                                {isImage && att.dataUrl ? (
                                  <img
                                    className="object-cover w-full h-full"
                                    src={att.dataUrl}
                                    alt={`${att.name}`}
                                  />
                                ) : isAudio ? (
                                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                                    <IconMusic size={20} />
                                    {durLabel && (
                                      <span className="text-[10px] leading-none mt-0.5 tabular-nums opacity-70">
                                        {durLabel}
                                      </span>
                                    )}
                                  </div>
                                ) : isVideo ? (
                                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                                    <IconVideo size={20} />
                                  </div>
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
                                    : isAudio
                                      ? att.audioFormat
                                        ? `.${att.audioFormat}${durLabel ? ` · ${durLabel}` : ''}`
                                        : 'audio'
                                      : ext
                                        ? `.${ext}`
                                        : 'document'}
                                  {att.size
                                    ? ` · ${formatBytes(att.size, {
                                        decimals: (_, unit) =>
                                          unit === 'B' ? 0 : 1,
                                      })}`
                                    : ''}
                                </div>
                                {isAudio && att.dataUrl && (
                                  <audio
                                    controls
                                    src={att.dataUrl}
                                    className="mt-1 w-56"
                                  />
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>

                          {/* Remove button disabled while processing - outside overflow-hidden container */}
                          {!att.processing && (
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
              </div>
            )}
            {queuedMessages.length > 0 && (
              <div className="flex flex-col gap-1 px-3 pt-2 pb-0">
                {queuedMessages.map((msg) => (
                  <QueuedMessageChip
                    key={msg.id}
                    message={msg}
                    onEdit={(queued) => {
                      // Put the text back in the input for editing, remove from queue
                      setPrompt(queued.text)
                      removeQueuedMessage(queued.id)
                      textareaRef.current?.focus()
                    }}
                    onRemove={removeQueuedMessage}
                  />
                ))}
              </div>
            )}
            <div className="relative">
              {highlightedPrefix && prompt.startsWith(highlightedPrefix) && (
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-4 text-transparent',
                    className
                  )}
                  style={{ overflowWrap: 'break-word' }}
                >
                  <mark className="rounded-sm bg-primary/20 text-transparent">
                    {highlightedPrefix}
                  </mark>
                  {prompt.slice(highlightedPrefix.length)}
                </div>
              )}
              <TextareaAutosize
                data-composer-width={composerWidth}
                dir="auto"
                ref={textareaRef}
                minRows={2}
                rows={1}
                maxRows={10}
                value={prompt}
                data-testid={'chat-input'}
                onScroll={(event) => {
                  if (highlightRef.current) {
                    highlightRef.current.scrollTop =
                      event.currentTarget.scrollTop
                    highlightRef.current.scrollLeft =
                      event.currentTarget.scrollLeft
                  }
                }}
                onChange={(e) => {
                  const value = e.target.value
                  const cursorIdx = e.target.selectionStart

                  // Track when @ is freshly typed
                  const prevPrompt = prompt
                  handlePromptChange(value)

                  // Snapshot cursor position when user types @
                  if (value.includes('@') && !prevPrompt.includes('@')) {
                    filePickerCursorPos.current = cursorIdx
                  } else if (value.endsWith('@') && cursorIdx > 0) {
                    filePickerCursorPos.current = cursorIdx
                  } else if (!value.includes('@')) {
                    filePickerCursorPos.current = null
                  } else if (filePickerCursorPos.current == null) {
                    // If picker already open, keep tracking cursor
                    filePickerCursorPos.current = cursorIdx
                  }

                  // Count the number of newlines to estimate rows
                  const newRows = (value.match(/\n/g) || []).length + 1
                  setRows(Math.min(newRows, maxRows))
                }}
                onKeyDown={(e) => {
                  // e.keyCode 229 is for IME input with Safari
                  const isComposing =
                    e.nativeEvent.isComposing || e.keyCode === 229
                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                    e.preventDefault()
                    // Submit prompt when Enter is pressed without Shift and prompt is not empty.
                    // If streaming, handleSendMessage will queue the message automatically.
                    if ((prompt.trim() || hasSendableMedia) && !ingestingAny) {
                      handleSendMessage(prompt)
                    }
                    // When Shift+Enter is pressed, a new line is added (default behavior)
                  }
                  // Navigate prompt history with Up/Down arrow keys
                  if (e.key === 'ArrowUp' && !isComposing) {
                    const textarea = e.currentTarget
                    const cursorAtStart =
                      textarea.selectionStart === 0 &&
                      textarea.selectionEnd === 0
                    if (cursorAtStart || !prompt) {
                      e.preventDefault()
                      navigateHistory('up')
                    }
                  }
                  if (e.key === 'ArrowDown' && !isComposing) {
                    const textarea = e.currentTarget
                    const cursorAtEnd =
                      textarea.selectionStart === prompt.length &&
                      textarea.selectionEnd === prompt.length
                    if (cursorAtEnd) {
                      e.preventDefault()
                      navigateHistory('down')
                    }
                  }
                  // Tab completes the selected @path file reference
                  if (
                    e.key === 'Tab' &&
                    filePickerOpen &&
                    filePickerEntries.length > 0 &&
                    !isComposing
                  ) {
                    e.preventDefault()
                    // Select the first entry as the default Tab completion
                    handleFilePickerSelect(filePickerEntries[0])
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
                  'bg-transparent pt-4 pb-0 w-full shrink-0 border-none resize-none outline-0 px-4 leading-6',
                  rows < maxRows && 'scrollbar-hide',
                  className
                )}
              />
            </div>
            {/* @path file reference picker popover */}
            {filePickerOpen && effectiveAgentMode && (
              <div className="relative">
                <FilePickerPopover
                  entries={filePickerEntries}
                  query={filePickerQuery}
                  open={filePickerOpen}
                  position={filePickerPosition}
                  onSelect={handleFilePickerSelect}
                  onClose={handleFilePickerClose}
                  textareaRef={textareaRef}
                />
              </div>
            )}

            {/* File inputs must survive closing the attachment menu. */}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              onChange={handleFileChange}
            />
            <input
              type="file"
              ref={audioInputRef}
              className="hidden"
              multiple
              accept="audio/wav,audio/mpeg,.wav,.mp3"
              onChange={handleAudioFileChange}
            />
            <input
              type="file"
              ref={videoInputRef}
              className="hidden"
              multiple
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.webm,.mkv,.avi,.m4v"
              onChange={handleVideoFileChange}
            />
            <div className="relative z-20 w-full px-2 pt-2 pb-3">
              <div className="flex flex-nowrap items-center justify-between gap-2 w-full @max-[360px]/composer:gap-1">
                <div className="px-1 flex flex-nowrap items-center gap-1 flex-1 min-w-0 @max-[520px]/composer:flex-none">
                  <div className={cn('px-1 flex flex-nowrap items-center gap-1')}>
                    {/* All actions stay in this menu when narrow composers hide inline shortcuts. */}
                    <DropdownMenu
                      open={optionsOpen}
                      onOpenChange={(open) => {
                        setOptionsOpen(open)
                        if (!open) setAssistantMenuOpen(false)
                      }}
                    >
                      <DropdownMenuTrigger asChild>
                        <Button
                          ref={optionsTriggerRef}
                          aria-label="Add attachments and controls"
                          variant="secondary"
                          size="icon"
                          className="shrink-0 rounded-full mr-1"
                        >
                          <PlusIcon className="size-[18px] text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        onInteractOutside={(event) => {
                          const target = event.target as HTMLElement | null
                          if (
                            target?.closest(
                              '[data-radix-popper-content-wrapper],[role="dialog"]'
                            )
                          )
                            event.preventDefault()
                        }}
                      >
                        {!effectiveAgentMode && hasMmproj && (
                          <DropdownMenuItem
                            disabled={isStreaming}
                            onClick={() => void openImagePicker()}
                          >
                            <IconPhoto
                              size={18}
                              className="text-muted-foreground"
                            />
                            <span>Add Images</span>
                          </DropdownMenuItem>
                        )}
                        {!effectiveAgentMode && audioSupported && (
                          <DropdownMenuItem
                            disabled={isStreaming}
                            onClick={() => void openAudioPicker()}
                          >
                            <IconMusic
                              size={18}
                              className="text-muted-foreground"
                            />
                            <span>Add Audio</span>
                          </DropdownMenuItem>
                        )}
                        {!effectiveAgentMode && videoSupported && (
                          <DropdownMenuItem
                            disabled={isStreaming}
                            onClick={() => void openVideoPicker()}
                          >
                            <IconVideo
                              size={18}
                              className="text-muted-foreground"
                            />
                            <span>Add Video</span>
                          </DropdownMenuItem>
                        )}
                        {/* RAG document attachments - desktop-only via dialog; shown when feature enabled */}
                        {!effectiveAgentMode && (
                          <DropdownMenuItem
                            disabled={isStreaming}
                            onClick={handleAttachDocsIngest}
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
                                : 'Upload or add files'}
                            </span>
                          </DropdownMenuItem>
                        )}
                        {menuWorkspace}
                        <DropdownMenuSeparator />
                        {supportsAssistants && assistants.length > 0 && (
                          <DropdownMenuSub
                            open={assistantMenuOpen}
                            onOpenChange={setAssistantMenuOpen}
                          >
                            <DropdownMenuSubTrigger disabled={isStreaming}>
                              <UserRound className="size-4 text-muted-foreground" />
                              Assistant
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-0 w-[min(320px,calc(100vw-16px),var(--radix-dropdown-menu-content-available-width))] max-h-64 overflow-y-auto">
                              <AssistantsMenu
                                assistants={assistants}
                                currentThread={currentThread}
                                selectedAssistant={selectedAssistantId}
                                setSelectedAssistant={setSelectedAssistantId}
                                updateCurrentThreadAssistant={
                                  updateCurrentThreadAssistant
                                }
                              />
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        {showToolControls &&
                          hasJanBrowserMCPConfig &&
                          modelSupportsBrowser && (
                            <DropdownMenuCheckboxItem
                              checked={janBrowserMCPActive}
                              onSelect={(event) => event.preventDefault()}
                              disabled={isStreaming || isJanBrowserMCPLoading}
                              onCheckedChange={() => void handleBrowseClick()}
                            >
                              <IconBrandChrome size={18} />
                              {isJanBrowserMCPLoading
                                ? t('common:starting')
                                : t('common:browse')}
                            </DropdownMenuCheckboxItem>
                          )}
                        {!effectiveAgentMode && selectedModel?.capabilities?.includes('tools') && (
                          <DropdownMenuCheckboxItem checked={webSearchEnabled} onSelect={(event) => event.preventDefault()} disabled={isStreaming} onCheckedChange={(checked) => setWebSearchEnabled(checked === true)}>
                            <IconWorldSearch size={18} />
                            {t('common:web_search')}
                          </DropdownMenuCheckboxItem>
                        )}
                        {menuControls}
                        {showToolControls &&
                          sandboxEnforcesShell &&
                          selectedModel?.capabilities?.includes('tools') && (
                            <DropdownMenuCheckboxItem
                              checked={shellEnabled}
                              onSelect={(event) => event.preventDefault()}
                              disabled={isStreaming}
                              onCheckedChange={(checked) => setShellEnabled(checked === true)}
                            >
                              <IconTerminal2 size={18} />
                              {t('common:shell')}
                            </DropdownMenuCheckboxItem>
                          )}
                        {showToolControls &&
                          selectedModel?.capabilities?.includes('tools') &&
                          hasActiveMCPServers && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger disabled={isStreaming}>
                                <IconTool size={18} />
                                {t('tools')}
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                                {Object.entries(toolsByServer).map(
                                  ([server, serverTools]) => (
                                    <DropdownMenuSub key={server}>
                                      <DropdownMenuSubTrigger
                                        disabled={isStreaming}
                                      >
                                        <span className="min-w-0 truncate">{server}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                          {serverTools.length} {t('tools')}
                                        </span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
                                        <DropdownMenuCheckboxItem
                                          disabled={isStreaming}
                                          checked={
                                            serverTools.every((tool) => !disabledTools.includes(createToolKey(server, tool.name)))
                                              ? true
                                              : serverTools.some((tool) => !disabledTools.includes(createToolKey(server, tool.name)))
                                                ? 'indeterminate'
                                                : false
                                          }
                                          onSelect={(event) => event.preventDefault()}
                                          onCheckedChange={(enabled) => {
                                            serverTools.forEach((tool) =>
                                              setToolDisabled(server, tool.name, enabled === true)
                                            )
                                          }}
                                        >
                                          All Tools
                                        </DropdownMenuCheckboxItem>
                                        <DropdownMenuSeparator />
                                        {serverTools.map((tool) => {
                                          const enabled =
                                            !disabledTools.includes(
                                              createToolKey(server, tool.name)
                                            )
                                          return (
                                            <DropdownMenuCheckboxItem
                                              className="gap-3 pl-2 [&>span:first-child]:hidden"
                                              disabled={isStreaming}
                                              key={tool.name}
                                              checked={enabled}
                                              aria-label={tool.name}
                                              title={tool.description}
                                              onSelect={(event) => event.preventDefault()}
                                              onCheckedChange={(checked) =>
                                                setToolDisabled(server, tool.name, checked === true)
                                              }
                                            >
                                              <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">
                                                  {tool.name}
                                                </span>
                                                {tool.description && (
                                                  <span className="line-clamp-2 text-xs text-muted-foreground">
                                                    {tool.description}
                                                  </span>
                                                )}
                                              </span>
                                              <span
                                                aria-hidden="true"
                                                className={cn(
                                                  'ml-auto flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors',
                                                  enabled ? 'border-primary bg-primary' : 'border-input bg-input'
                                                )}
                                              >
                                                <span className={cn(
                                                  'size-3.5 rounded-full bg-background shadow-sm transition-transform',
                                                  enabled && 'translate-x-4'
                                                )} />
                                              </span>
                                            </DropdownMenuCheckboxItem>
                                          )
                                        })}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                  )
                                )}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}
                        {!isPredefinedRemoteProvider(selectedProvider) && (
                          <DropdownMenuItem disabled={isStreaming} onSelect={() => { setOptionsOpen(false); setSamplingOpen(true) }}>
                            <SlidersHorizontal className="size-4 text-muted-foreground" />
                            Sampling parameters
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {leadingControls}
                    <div
                      className={cn(
                        'flex items-center gap-1 @max-[520px]/composer:hidden',
                        isStreaming && 'opacity-50 pointer-events-none'
                      )}
                    >
                      {showToolControls &&
                        hasJanBrowserMCPConfig &&
                        modelSupportsBrowser &&
                        janBrowserMCPActive && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                disabled={isStreaming || isJanBrowserMCPLoading}
                                aria-label={t('common:browse')}
                                aria-pressed={janBrowserMCPActive}
                                className={cn(
                                  janBrowserMCPActive && 'text-primary'
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
                                  ? t('common:starting')
                                  : janBrowserMCPActive
                                    ? t('common:browse') +
                                      t('common:activeSuffix')
                                    : t('common:browse')}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                      {showToolControls &&
                        selectedModel?.capabilities?.includes('tools') &&
                        hasActiveMCPServers &&
                        enabledMcpTools.length > 0 &&
                        (MCPToolComponent ? (
                          // Use custom MCP component
                          <McpExtensionToolLoader
                            tools={tools}
                            hasActiveMCPServers={hasActiveMCPServers}
                            selectedModelHasTools={
                              selectedModel?.capabilities?.includes('tools') ??
                              false
                            }
                            MCPToolComponent={MCPToolComponent}
                          />
                        ) : (
                          // Use default tools dropdown
                          <Tooltip
                            open={tooltipShown === 'tools'}
                            onOpenChange={(newValue) =>
                              newValue
                                ? setTooltipShown('tools')
                                : setTooltipShown(false)
                            }
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
                                  onOpenChange={(isOpen) => {
                                    setDropdownToolsAvailable(isOpen)
                                    if (isOpen) {
                                      setTooltipShown(false)
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
                                          className={cn(
                                            'text-muted-foreground'
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

                      {!effectiveAgentMode &&
                        selectedModel?.capabilities?.includes('tools') &&
                        webSearchEnabled && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className={cn(
                                  webSearchEnabled && 'text-primary'
                                )}
                                aria-label={t('common:web_search')}
                                aria-pressed={webSearchEnabled}
                                disabled={isStreaming}
                                onClick={() =>
                                  setWebSearchEnabled(!webSearchEnabled)
                                }
                              >
                                <IconWorldSearch
                                  size={18}
                                  className={cn(
                                    'text-muted-foreground',
                                    webSearchEnabled && 'text-primary'
                                  )}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {webSearchEnabled
                                  ? t('common:web_search') +
                                    t('common:activeSuffix')
                                  : t('common:web_search')}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                      {showToolControls &&
                        sandboxEnforcesShell &&
                        shellEnabled &&
                        selectedModel?.capabilities?.includes('tools') && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-pressed={shellEnabled}
                                aria-label={t('common:shell')}
                                className={cn(shellEnabled && 'text-primary')}
                                onClick={() => setShellEnabled(!shellEnabled)}
                              >
                                <IconTerminal2
                                  size={18}
                                  className={cn(
                                    'text-muted-foreground',
                                    shellEnabled && 'text-primary'
                                  )}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {shellEnabled
                                  ? t('common:shell') + t('common:activeSuffix')
                                  : t('common:shell')}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                    </div>
                  </div>
                  {surfaceControls && (
                    // Surface actions remain available through menuControls/menuWorkspace.
                    <div className="flex shrink-0 items-center gap-1 @max-[520px]/composer:hidden">
                      {surfaceControls}
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 shrink items-center justify-end gap-2 @max-[520px]/composer:flex-1 @max-[360px]/composer:gap-1">
                  <ComposerModelPicker
                    model={model}
                    useLastUsedModel={initialMessage}
                    onModelChange={onModelChange}
                    className={cn('min-w-0 @max-[520px]/composer:max-w-full shrink', leadingControls && 'h-9')}
                  />

                  {isStreaming || toolsRunning ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          data-testid="stop-message-button"
                          className="shrink-0 rounded-full mr-1"
                          onClick={() => {
                            // Stopping with messages queued clears the queue —
                            // there is nothing to interrupt yet. The old
                            // `if (!currentThreadId) return` guard made this button
                            // inert for any surface without a thread id.
                            if (queueId) {
                              const queue = useMessageQueue
                                .getState()
                                .getQueue(queueId)
                              if (queue.length > 0) {
                                useMessageQueue.getState().clearQueue(queueId)
                                return
                              }
                            }
                            stopStreaming(currentThreadId ?? '')
                          }}
                        >
                          <IconPlayerStopFilled />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {queueLength > 0
                            ? `Clear ${queueLength} queued message(s)`
                            : 'Stop generating'}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      variant="default"
                      size="icon-sm"
                      disabled={
                        (!prompt.trim() && !hasSendableMedia) || ingestingAny
                      }
                      data-test-id="send-message-button"
                      data-testid="send-message-button"
                      onClick={() => handleSendMessage(prompt)}
                      className="shrink-0 rounded-full mr-1"
                    >
                      <ArrowRight className="text-primary-fg" />
                    </Button>
                  )}
                </div>
              </div>
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

      {tokenCounterVisible && (
        <div className="w-full flex justify-end px-0.5">
          <TokenCounter messages={threadMessages || []} source={tokenSource} />
        </div>
      )}

      <SamplerPopover
        open={samplingOpen}
        onOpenChange={setSamplingOpen}
        hideTrigger
        returnFocusRef={optionsTriggerRef}
        providerId={selectedProvider}
        modelId={selectedModel?.id}
        assistantSwitcher={supportsAssistants ? { assistants, currentThread, selectedAssistantId, setSelectedAssistantId, updateCurrentThreadAssistant } : undefined}
      />
      <JanBrowserExtensionDialog
        open={extensionDialogOpen}
        onOpenChange={setExtensionDialogOpen}
        state={extensionDialogState}
        onCancel={handleExtensionDialogCancel}
      />
    </div>
  )
})

export default ChatInput

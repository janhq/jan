import TextareaAutosize from 'react-textarea-autosize'
import { invoke } from '@tauri-apps/api/core'
import { cn, formatBytes } from '@/lib/utils'
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
  IconMusic,
  IconVideo,
  IconBrain,
  IconTool,
  IconCodeCircle2,
  IconPlayerStopFilled,
  IconX,
  IconPaperclip,
  IconLoader2,
  IconWorld,
  IconBrandChrome,
} from '@tabler/icons-react'
import { generateId } from 'ai'
import { useMessageQueue } from '@/stores/message-queue-store'
import { QueuedMessageChip } from '@/containers/QueuedMessageBubble'
import { SamplerPopover } from '@/containers/SamplerPopover'
import { BotIcon } from 'lucide-react'
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
import { useAssistant } from '@/hooks/useAssistant'
import { AssistantSwitcher } from '@/containers/AssistantSwitcher'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTools } from '@/hooks/useTools'
import { TokenCounter } from '@/components/TokenCounter'
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
import { toast } from 'sonner'
import { isPlatformTauri } from '@/lib/platform/utils'
import { useAttachmentIngestionPrompt } from '@/hooks/useAttachmentIngestionPrompt'
import {
  NEW_THREAD_ATTACHMENT_KEY,
  useChatAttachments,
} from '@/hooks/useChatAttachments'
import {
  OPENUI_CHAT_ACTION_EVENT,
  isOpenUIChatActionEvent,
} from '@/lib/openui-actions'

import {
  Attachment,
  createImageAttachment,
  createDocumentAttachment,
  createAudioAttachment,
  createVideoAttachment,
} from '@/types/attachment'
import JanBrowserExtensionDialog from '@/containers/dialogs/JanBrowserExtensionDialog'
import { useJanBrowserExtension } from '@/hooks/useJanBrowserExtension'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useOpenUISettings } from '@/hooks/useOpenUISettings'

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
  const tokenCounterCompact = useGeneralSetting(
    (state) => state.tokenCounterCompact
  )
  useTools()
  const router = useRouter()
  const createThread = useThreads((state) => state.createThread)
  const { 
    loading,
    currentAssistant,
    setCurrentAssistant,
    assistants
  } = useAssistant()

  // Agent mode
  // Use TEMPORARY_CHAT_ID as fallback key on the home screen (same pattern as attachments)
  const agentModeKey = currentThreadId ?? TEMPORARY_CHAT_ID
  const isAgentMode = useAgentMode((state) =>
    state.agentThreads[agentModeKey] === true
  )
  // When projectId is present, treat as normal chat (disable agent mode UI)
  const effectiveAgentMode = isAgentMode && !projectId
  const toggleAgentMode = useAgentMode((state) => state.toggleAgentMode)

  const handleAgentToggle = useCallback(() => {
    toggleAgentMode(agentModeKey)
  }, [agentModeKey, toggleAgentMode])

  const openUIThreadKey = currentThreadId ?? TEMPORARY_CHAT_ID
  const isOpenUIEnabled = useOpenUISettings(
    (state) => state.enabledThreads[openUIThreadKey] === true
  )
  const toggleOpenUI = useOpenUISettings((state) => state.toggleEnabled)

  const handleOpenUIToggle = useCallback(() => {
    toggleOpenUI(openUIThreadKey)
  }, [openUIThreadKey, toggleOpenUI])

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
  const [tooltipShown, setTooltipShown] = useState<
    'tools' | 'assistants' | false
  >(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasMmproj, setHasMmproj] = useState(false)
  const activeModels = useAppState(useShallow((state) => state.activeModels))
  // Check if selected model is currently loaded/active
  const isModelActive = selectedModel?.id ? activeModels.includes(selectedModel.id) : false

  // Reconcile video capability from /props once the model is loaded.
  useReconcileVideoCapability(selectedModel?.id, selectedProvider, isModelActive)
  const [selectedAssistantId, setSelectedAssistantId] = useState<
    string | undefined
  >(loading ? undefined : currentAssistant?.id || '')

  useEffect(() => {
    setSelectedAssistantId(currentAssistant?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)

  // Derived: any document currently processing (ingestion in progress)
  const attachmentsKey = currentThreadId ?? NEW_THREAD_ATTACHMENT_KEY
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
  const getProviderByName = useModelProvider((state) => state.getProviderByName)

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
  const queuedMessages = useMessageQueue(
    useShallow((s) => s.getQueue(currentThreadId ?? ''))
  )
  const queueLength = queuedMessages.length

  const removeQueuedMessage = useCallback(
    (id: string) => {
      useMessageQueue.getState().removeMessage(currentThreadId ?? '', id)
    },
    [currentThreadId]
  )

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
    if (!prompt.trim() && !hasSendableMedia) {
      return
    }
    if (ingestingAny) {
      toast.info('Please wait for attachments to finish processing')
      return
    }

    setMessage('')
    addToHistory(prompt)

    // Use onSubmit prop if available (AI SDK), otherwise create thread and navigate
    if (onSubmit) {
      // When the model is still streaming, queue the message for later
      if (isStreaming && currentThreadId) {
        useMessageQueue.getState().enqueue(currentThreadId, {
          id: generateId(),
          text: prompt,
          createdAt: Date.now(),
        })
        setPrompt('')
        return
      }

      const imageFiles = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))
      const audioFiles = attachments
        .filter((att) => att.type === 'audio' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.audioFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav',
          url: att.dataUrl!,
        }))
      const videoFiles = attachments
        .filter((att) => att.type === 'video' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'video/mp4',
          url: att.dataUrl!,
        }))
      const files = [...imageFiles, ...audioFiles, ...videoFiles]

      onSubmit(prompt, files.length > 0 ? files : undefined)
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
        text: prompt,
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
          : assistants.find((a) => a.id === selectedAssistantId)

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

        useOpenUISettings
          .getState()
          .transferThread(openUIThreadKey, newThread.id)

        // Transfer agent mode from home screen to the new thread
        if (isAgentMode) {
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
  const handleSendMessageRef = useRef(handleSendMessage)

  // Keep the once-registered OpenUI listener pointed at the latest send closure.
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage
  })

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
      // Escalate: if the llama.cpp model is still processing after the HTTP
      // abort, force-unload it so generation actually stops. KV cache is lost.
      const modelId = selectedModel?.id
      if (selectedProvider === 'llamacpp' && modelId) {
        setTimeout(() => {
          invoke('plugin:llamacpp|force_stop_model', { modelId }).catch((e) => {
            console.warn('force_stop_model failed:', e)
          })
        }, 500)
      }
    },
    [abortControllers, cancelToolCall, onStop, selectedModel?.id, selectedProvider]
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
      // (processAttachmentsForSend inside processAndSendMessage).
      const docsNeedingPrompt = docs.filter((doc) => {
        if (doc.processed || doc.injectionMode) return false
        const preference = doc.parseMode ?? parsePreference
        return preference === 'prompt' || preference === 'auto'
      })

      if (docsNeedingPrompt.length > 0) {
        const choices = new Map<string, 'inline' | 'embeddings'>()
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

          if (doc.path) {
            choices.set(doc.path, choice)
          }
        }

        // Persist each document's chosen mode so processAttachmentsForSend
        // can pick it up at send time.
        if (choices.size > 0) {
          setAttachmentsForThread(attachmentsKey, (prev) =>
            prev.map((att) => {
              const mode = att.path ? choices.get(att.path) : undefined
              return mode ? { ...att, parseMode: mode } : att
            })
          )
        }
      }
    },
    [
      ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES,
      attachmentsKey,
      parsePreference,
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

  const processImageFiles = useCallback(async (files: File[]) => {
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

    // Compute content hashes for deduplication (allows different images with same filename)
    for (const att of preparedFiles) {
      if (att.base64) {
        att.contentHash = await hashBase64(att.base64)
      }
    }

    const duplicates: string[] = []
    const newFiles: Attachment[] = []

    const currentAttachments = useChatAttachments.getState().getAttachments(
      attachmentsKey
    )

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
        hash &&
        (existingImageHashes.has(hash) || seenHashesInBatch.has(hash))
      const isDuplicateByName =
        existingImageNames.has(att.name)
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
  }, [attachmentsKey, currentThreadId, setAttachmentsForThread, serviceHub, setFileIngestProgress])

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
        const isWav = file.type === 'audio/wav' || file.type === 'audio/x-wav' || ext === 'wav'
        const isMp3 = file.type === 'audio/mpeg' || file.type === 'audio/mp3' || ext === 'mp3'
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
          reader.onerror = () => reject(reader.error ?? new Error('read failed'))
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

      const current = useChatAttachments.getState().getAttachments(attachmentsKey)
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
              const fileName = path.split(/[\\/]/).filter(Boolean).pop() || 'audio'
              const ext = fileName.toLowerCase().split('.').pop()
              const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'
              files.push(new File([blob], fileName, { type: mimeType }))
            } catch (error) {
              console.error('Failed to read audio file:', error)
              toast.error('Failed to read audio file', {
                description: error instanceof Error ? error.message : String(error),
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
          reader.onerror = () => reject(reader.error ?? new Error('read failed'))
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

      const current = useChatAttachments.getState().getAttachments(attachmentsKey)
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
              const fileName = path.split(/[\\/]/).filter(Boolean).pop() || 'video'
              const ext = fileName.toLowerCase().split('.').pop()
              files.push(new File([blob], fileName, { type: videoMimeForExt(ext) }))
            } catch (error) {
              console.error('Failed to read video file:', error)
              toast.error('Failed to read video file', {
                description: error instanceof Error ? error.message : String(error),
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

  useEffect(() => {
    const handleOpenUIAction = (event: Event) => {
      if (!isOpenUIChatActionEvent(event)) return

      const nextPrompt = event.detail.prompt.trim()
      if (!nextPrompt) return

      event.preventDefault()
      handleSendMessageRef.current(nextPrompt)
    }

    window.addEventListener(OPENUI_CHAT_ACTION_EVENT, handleOpenUIAction)

    return () => {
      window.removeEventListener(OPENUI_CHAT_ACTION_EVENT, handleOpenUIAction)
    }
  }, [])

  return (
    <div className="relative">
      <div className="relative">
        <div
          className={cn(
            'relative overflow-hidden p-0.5 rounded-3xl'
          )}
        >
          {isStreaming && (
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
              'relative z-20 px-0 pb-10 border rounded-3xl border-input bg-white dark:bg-input/30',
              isFocused && 'ring-1 ring-ring/50',
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
                          ? `${Math.floor(att.durationSec / 60)}:${Math.floor(att.durationSec % 60)
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
                              <IconX
                                className="text-neutral-200"
                                size={14}
                              />
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
                    <Button variant="secondary" size="icon-sm" className='rounded-full mr-2 mb-1'>
                      <PlusIcon size={18} className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {hasMmproj && (
                      <DropdownMenuItem onClick={() => void openImagePicker()}>
                        <IconPhoto size={18} className="text-muted-foreground" />
                        <span>Add Images</span>
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          multiple
                          onChange={handleFileChange}
                        />
                      </DropdownMenuItem>
                    )}
                    {audioSupported && (
                      <DropdownMenuItem onClick={() => void openAudioPicker()}>
                        <IconMusic size={18} className="text-muted-foreground" />
                        <span>Add Audio</span>
                        <input
                          type="file"
                          ref={audioInputRef}
                          className="hidden"
                          multiple
                          accept="audio/wav,audio/mpeg,.wav,.mp3"
                          onChange={handleAudioFileChange}
                        />
                      </DropdownMenuItem>
                    )}
                    {videoSupported && (
                      <DropdownMenuItem onClick={() => void openVideoPicker()}>
                        <IconVideo size={18} className="text-muted-foreground" />
                        <span>Add Video</span>
                        <input
                          type="file"
                          ref={videoInputRef}
                          className="hidden"
                          multiple
                          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.webm,.mkv,.avi,.m4v"
                          onChange={handleVideoFileChange}
                        />
                      </DropdownMenuItem>
                    )}
                    {/* RAG document attachments - desktop-only via dialog; shown when feature enabled */}
                    <DropdownMenuItem
                      onClick={handleAttachDocsIngest}
                      disabled={!selectedModel?.capabilities?.includes('tools')}
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
                <AssistantSwitcher
                  assistants={assistants}
                  currentThread={currentThread}
                  selectedAssistantId={selectedAssistantId}
                  setSelectedAssistantId={setSelectedAssistantId}
                  updateCurrentThreadAssistant={updateCurrentThreadAssistant}
                />
                <SamplerPopover
                  providerId={selectedProvider}
                  modelId={selectedModel?.id}
                  assistantSwitcher={{
                    assistants,
                    currentThread,
                    selectedAssistantId,
                    setSelectedAssistantId,
                    updateCurrentThreadAssistant,
                  }}
                />
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

                {!effectiveAgentMode && selectedModel?.capabilities?.includes('embeddings') && (
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

                {!effectiveAgentMode &&
                  selectedModel?.capabilities?.includes('tools') &&
                  hasActiveMCPServers &&
                  MCPToolComponent && (
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
                  )}

                <Tooltip
                  open={tooltipShown === 'tools'}
                  onOpenChange={(newValue) =>
                    newValue
                      ? setTooltipShown('tools')
                      : setTooltipShown(false)
                  }
                >
                  <DropdownToolsAvailable
                    initialMessage={initialMessage}
                    openUIEnabled={isOpenUIEnabled}
                    onOpenUIToggle={handleOpenUIToggle}
                    showMCPTools={
                      !effectiveAgentMode &&
                      selectedModel?.capabilities?.includes('tools') &&
                      hasActiveMCPServers &&
                      !MCPToolComponent
                    }
                    onOpenChange={(isOpen) => {
                      setDropdownToolsAvailable(isOpen)
                      if (isOpen) {
                        setTooltipShown(false)
                      }
                    }}
                  >
                    {() => (
                      <TooltipTrigger asChild disabled={dropdownToolsAvailable}>
                        <Button
                          variant={isOpenUIEnabled ? 'default' : 'ghost'}
                          size="icon-xs"
                          aria-label={t('tools')}
                          onClick={(event) => event.stopPropagation()}
                          className={cn(
                            isOpenUIEnabled &&
                              'text-primary bg-primary/10 hover:bg-primary/10'
                          )}
                        >
                          <IconTool
                            size={18}
                            className={cn(
                              'text-muted-foreground',
                              isOpenUIEnabled && 'text-primary'
                            )}
                          />
                        </Button>
                      </TooltipTrigger>
                    )}
                  </DropdownToolsAvailable>
                  <TooltipContent>
                    <p>{t('tools')}</p>
                  </TooltipContent>
                </Tooltip>

                {/* Agent mode toggle hidden — kept as dead code for future use */}
                {false && !projectId && isAgentMode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isAgentMode ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={currentThreadId ? handleAgentToggle : undefined}
                        className={cn(
                          isAgentMode && 'text-primary bg-primary/10 hover:bg-primary/10 items-center',
                          !currentThreadId && 'cursor-default pointer-events-none'
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

                {!effectiveAgentMode && selectedModel?.capabilities?.includes('web_search') && (
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

                {!effectiveAgentMode &&
                  selectedProvider === 'llamacpp' &&
                  (() => {
                    const reasoningValue =
                      (selectedModel?.settings?.reasoning?.controller_props
                        ?.value as 'auto' | 'on' | 'off' | undefined) ?? 'auto'
                    const setReasoning = (value: 'auto' | 'on' | 'off') => {
                      if (!selectedProvider || !selectedModel) return
                      const providerObj = getProviderByName(selectedProvider)
                      if (!providerObj) return
                      const modelIndex = providerObj.models.findIndex(
                        (m) => m.id === selectedModel.id
                      )
                      if (modelIndex === -1) return
                      const existing =
                        selectedModel.settings?.reasoning ?? {
                          key: 'reasoning',
                          title: 'Reasoning',
                          description: '',
                          controller_type: 'dropdown',
                          controller_props: { value },
                        }
                      const updatedModel = {
                        ...selectedModel,
                        settings: {
                          ...selectedModel.settings,
                          reasoning: {
                            ...existing,
                            controller_props: {
                              ...(existing.controller_props ?? {}),
                              value,
                            },
                          },
                        },
                      } as Model
                      const updatedModels = [...providerObj.models]
                      updatedModels[modelIndex] = updatedModel
                      updateProvider(selectedProvider, {
                        models: updatedModels,
                      })
                      // selectedModel is a snapshot, not a live derivation —
                      // re-select to refresh it so the dropdown UI and the
                      // chat transport both observe the new value.
                      selectModelProvider(selectedProvider, selectedModel.id)
                    }
                    const label =
                      reasoningValue === 'on'
                        ? 'On'
                        : reasoningValue === 'off'
                          ? 'Off'
                          : 'Auto'
                    const tooltipText =
                      reasoningValue === 'on'
                        ? 'Reasoning forced on for every request.'
                        : reasoningValue === 'off'
                          ? 'Reasoning disabled for every request.'
                          : "Reasoning auto-detected from the model's chat template."
                    return (
                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Reasoning: ${label}`}
                              >
                                <IconBrain
                                  size={18}
                                  className={cn(
                                    'text-muted-foreground',
                                    reasoningValue === 'on' && 'text-primary',
                                    reasoningValue === 'off' && 'opacity-50'
                                  )}
                                />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{tooltipText}</p>
                          </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => setReasoning('auto')}>
                            Auto
                            {reasoningValue === 'auto' && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setReasoning('on')}>
                            On
                            {reasoningValue === 'on' && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setReasoning('off')}>
                            Off
                            {reasoningValue === 'off' && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  })()}
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
                    />
                  </div>
                )}

              {isStreaming ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      className="rounded-full mr-1 mb-1"
                      onClick={() => {
                        if (!currentThreadId) return
                        const queue = useMessageQueue.getState().getQueue(currentThreadId)
                        if (queue.length > 0) {
                          useMessageQueue.getState().clearQueue(currentThreadId)
                        } else {
                          stopStreaming(currentThreadId)
                        }
                      }}
                    >
                      <IconPlayerStopFilled />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{queueLength > 0 ? `Clear ${queueLength} queued message(s)` : 'Stop generating'}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="default"
                  size="icon-sm"
                  disabled={(!prompt.trim() && !hasSendableMedia) || ingestingAny}
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
            <TokenCounter messages={threadMessages || []} />
          </div>
        )}

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

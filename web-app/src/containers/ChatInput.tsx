'use client'

import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
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
  IconCheck,
  IconZoomScan,
} from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppState } from '@/hooks/useAppState'
import { MovingBorder } from './MovingBorder'
import { useChat } from '@/hooks/useChat'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { ModelLoader } from '@/containers/loaders/ModelLoader'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { JanImage } from '@/components/JanImage'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTools } from '@/hooks/useTools'
import { TokenCounter } from '@/components/TokenCounter'
import { useMessages } from '@/hooks/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { McpExtensionToolLoader } from './McpExtensionToolLoader'
import { ExtensionTypeEnum, MCPExtension, fs, RAGExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { useAttachments } from '@/hooks/useAttachments'
import { useDeepResearch } from '@/hooks/useDeepResearch'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { toast } from 'sonner'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { isPlatformTauri } from '@/lib/platform/utils'

import {
  Attachment,
  createImageAttachment,
  createDocumentAttachment,
} from '@/types/attachment'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
  projectId?: string
}

const ChatInput = ({
  model,
  className,
  initialMessage,
  projectId,
}: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const serviceHub = useServiceHub()
  const streamingContent = useAppState((state) => state.streamingContent)
  const abortControllers = useAppState((state) => state.abortControllers)
  const loadingModel = useAppState((state) => state.loadingModel)
  const tools = useAppState((state) => state.tools)
  const cancelToolCall = useAppState((state) => state.cancelToolCall)
  const prompt = usePrompt((state) => state.prompt)
  const setPrompt = usePrompt((state) => state.setPrompt)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const { t } = useTranslation()
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  const tokenCounterCompact = useGeneralSetting(
    (state) => state.tokenCounterCompact
  )
  useTools()

  // Get current thread messages for token counting
  const threadMessages = useMessages(
    useShallow((state) =>
      currentThreadId ? state.messages[currentThreadId] : []
    )
  )

  const maxRows = 10

  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const sendMessage = useChat()
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipToolsAvailable, setTooltipToolsAvailable] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasMmproj, setHasMmproj] = useState(false)
  const activeModels = useAppState(useShallow((state) => state.activeModels))
  const hasActiveModels = useMemo(
    () =>
      activeModels.length > 0 &&
      activeModels.some((e) => e === selectedModel?.id),
    [activeModels, selectedModel?.id]
  )

  const attachmentsEnabled = useAttachments((s) => s.enabled)

  // Deep Research mode state
  const deepResearchEnabled = useDeepResearch((state) => state.enabled)
  const toggleDeepResearch = useDeepResearch((state) => state.toggleDeepResearch)

  // Check if the selected model supports reasoning (required for Deep Research)
  const modelSupportsReasoning = useMemo(
    () => selectedModel?.capabilities?.includes('reasoning') ?? false,
    [selectedModel?.capabilities]
  )
  // Web Search tools management - for Deep Research integration
  const WEB_SEARCH_TOOL_NAMES = ['google_search', 'scrape']
  const {
    setToolDisabledForThread,
    setDefaultDisabledTools,
    getDefaultDisabledTools,
  } = useToolAvailable()
  const webSearchTools = useMemo(
    () => tools.filter((tool) => WEB_SEARCH_TOOL_NAMES.includes(tool.name)),
    [tools]
  )
  // Force enable web search when Deep Research is enabled
  useEffect(() => {
    if (deepResearchEnabled && webSearchTools.length > 0) {
      webSearchTools.forEach((tool) => {
        if (initialMessage) {
          const currentDefaults = getDefaultDisabledTools()
          const toolKey = `${tool.server}::${tool.name}`
          setDefaultDisabledTools(currentDefaults.filter((key) => key !== toolKey))
        } else if (currentThreadId) {
          setToolDisabledForThread(currentThreadId, tool.server, tool.name, true)
        }
      })
    }
  }, [deepResearchEnabled, webSearchTools, initialMessage, currentThreadId, setToolDisabledForThread, setDefaultDisabledTools, getDefaultDisabledTools])

  // Determine whether to show the Attach documents button (simple gating)
  const showAttachmentButton =
    attachmentsEnabled && PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
  // Derived: any document currently processing (ingestion in progress)
  const ingestingDocs = attachments.some(
    (a) => a.type === 'document' && a.processing
  )
  const ingestingAny = attachments.some((a) => a.processing)

  // Check for mmproj existence or vision capability when model changes
  useEffect(() => {
    const checkMmprojSupport = async () => {
      if (selectedModel && selectedModel?.id) {
        try {
          // Only check mmproj for llamacpp provider
          const hasVisionCap =
            selectedModel?.capabilities?.includes('vision') ||
            (selectedModel as any)?.supports_images === true

          if (hasVisionCap) {
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
  const hasActiveMCPServers = tools.length > 0

  // Get MCP extensions and their custom components
  // Use useMemo to re-evaluate when tools change (which happens when extensions load)
  const extensionManager = ExtensionManager.getInstance()

  const { MCPToolComponent, BrowserToolComponent } = useMemo(() => {
    const mcpExt = extensionManager.get<MCPExtension>(ExtensionTypeEnum.MCP)
    const mcpBrowserExt = extensionManager.getByName('mcp-browser') as MCPExtension | undefined
    return {
      MCPToolComponent: mcpExt?.getToolComponent?.(),
      BrowserToolComponent: mcpBrowserExt?.getToolComponent?.(),
    }
  }, [extensionManager, tools])

  const handleSendMessage = async (prompt: string) => {
    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }
    if (!prompt.trim()) {
      return
    }

    setMessage('')

    // Callback to update attachment processing state
    const updateAttachmentProcessing = (
      fileName: string,
      status: 'processing' | 'done' | 'error' | 'clear_docs' | 'clear_all'
    ) => {
      if (status === 'clear_docs') {
        setAttachments((prev) => prev.filter((a) => a.type !== 'document'))
        return
      }
      if (status === 'clear_all') {
        setAttachments([])
        return
      }
      setAttachments((prev) =>
        prev.map((att) =>
          att.name === fileName
            ? {
              ...att,
              processing: status === 'processing',
              processed: status === 'done' ? true : att.processed,
            }
            : att
        )
      )
    }

    sendMessage(
      prompt,
      true,
      attachments.length > 0 ? attachments : undefined,
      projectId,
      updateAttachmentProcessing,
      undefined, // continueFromMessageId
      deepResearchEnabled && modelSupportsReasoning // deep_research flag
    )
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
    if (!streamingContent && textareaRef.current) {
      // Small delay to ensure UI has updated
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 10)
    }
  }, [streamingContent])

  const stopStreaming = useCallback(
    (threadId: string) => {
      abortControllers[threadId]?.abort()
      cancelToolCall?.()
    },
    [abortControllers, cancelToolCall]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAttachDocsIngest = async () => {
    try {
      if (!attachmentsEnabled) {
        toast.info('Attachments are disabled in Settings')
        return
      }
      if (!PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]) {
        toast.info('File attachments are unavailable on this platform')
        return
      }
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

      // Check for duplicates and fetch file sizes
      const existingPaths = new Set(
        attachments
          .filter((a) => a.type === 'document' && a.path)
          .map((a) => a.path)
      )

      const duplicates: string[] = []
      const newDocAttachments: Attachment[] = []

      for (const p of paths) {
        if (existingPaths.has(p)) {
          duplicates.push(p.split(/[\\/]/).pop() || p)
          continue
        }

        const name = p.split(/[\\/]/).pop() || p
        const fileType = name.split('.').pop()?.toLowerCase()
        let size: number | undefined = undefined
        try {
          const stat = await fs.fileStat(p)
          size = stat?.size ? Number(stat.size) : undefined
        } catch (e) {
          console.warn('Failed to read file size for', p, e)
        }
        newDocAttachments.push(
          createDocumentAttachment({
            name,
            path: p,
            fileType,
            size,
          })
        )
      }

      if (duplicates.length > 0) {
        toast.warning('Files already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }

      if (newDocAttachments.length > 0) {
        // Add to state first with processing flag
        setAttachments((prev) => [...prev, ...newDocAttachments])

        // If thread exists, ingest immediately
        if (currentThreadId) {
          const ragExtension = ExtensionManager.getInstance().get(
            ExtensionTypeEnum.RAG
          ) as RAGExtension | undefined
          if (!ragExtension) {
            toast.error('RAG extension not available')
            return
          }

          // Ingest each document
          for (const doc of newDocAttachments) {
            try {
              // Mark as processing
              setAttachments((prev) =>
                prev.map((a) =>
                  a.path === doc.path && a.type === 'document'
                    ? { ...a, processing: true }
                    : a
                )
              )

              const result = await ragExtension.ingestAttachments(
                currentThreadId,
                [
                  {
                    path: doc.path!,
                    name: doc.name,
                    type: doc.fileType,
                    size: doc.size,
                  },
                ]
              )

              const fileInfo = result.files?.[0]
              if (fileInfo?.id) {
                // Mark as processed with ID
                setAttachments((prev) =>
                  prev.map((a) =>
                    a.path === doc.path && a.type === 'document'
                      ? {
                        ...a,
                        processing: false,
                        processed: true,
                        id: fileInfo.id,
                        chunkCount: fileInfo.chunk_count,
                      }
                      : a
                  )
                )
              } else {
                throw new Error('No file ID returned from ingestion')
              }
            } catch (error) {
              console.error('Failed to ingest document:', error)
              // Remove failed document
              setAttachments((prev) =>
                prev.filter(
                  (a) => !(a.path === doc.path && a.type === 'document')
                )
              )
              toast.error(`Failed to ingest ${doc.name}`, {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to attach documents:', e)
      const desc = e instanceof Error ? e.message : String(e)
      toast.error('Failed to attach documents', { description: desc })
    }
  }

  const handleRemoveAttachment = (indexToRemove: number) => {
    setAttachments((prev) => prev.filter((_, index) => index !== indexToRemove))
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
    const newFiles: Attachment[] = []
    const duplicates: string[] = []
    const oversizedFiles: string[] = []
    const invalidTypeFiles: string[] = []
    const existingImageNames = new Set(
      attachments.filter((a) => a.type === 'image').map((a) => a.name)
    )

    const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png']
    const validFiles: File[] = []

    Array.from(files).forEach((file) => {
      // Check for duplicate image names
      if (existingImageNames.has(file.name)) {
        duplicates.push(file.name)
        return
      }

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

    // Process valid files
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
            newFiles.push(att)
          }
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }

    // Update state and ingest
    if (newFiles.length > 0) {
      setAttachments((prev) => {
        const updated = [...prev, ...newFiles]
        return updated
      })

      // If thread exists, ingest images immediately
      if (currentThreadId) {
        void (async () => {
          for (const img of newFiles) {
            try {
              // Mark as processing
              setAttachments((prev) =>
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
                setAttachments((prev) =>
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
              setAttachments((prev) =>
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
    }

    // Display validation errors
    const errors: string[] = []

    if (duplicates.length > 0) {
      toast.warning('Some images already attached', {
        description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
      })
    }

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

  const handleImagePickerClick = async () => {
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
  }

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

  return (
    <div className="relative">
      <div className="relative">
        <div
          className={cn(
            'relative overflow-hidden p-[2px] rounded-lg',
            Boolean(streamingContent) && 'opacity-70'
          )}
        >
          {streamingContent && (
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
              'relative z-20 px-0 pb-10 border border-main-view-fg/5 rounded-lg text-main-view-fg bg-main-view',
              isFocused && 'ring-1 ring-main-view-fg/10',
              isDragOver && 'ring-2 ring-accent border-accent'
            )}
            data-drop-zone={hasMmproj ? 'true' : undefined}
            onDragEnter={hasMmproj ? handleDragEnter : undefined}
            onDragLeave={hasMmproj ? handleDragLeave : undefined}
            onDragOver={hasMmproj ? handleDragOver : undefined}
            onDrop={hasMmproj ? handleDrop : undefined}
          >
            {attachments.length > 0 && (
              <div className="flex gap-3 items-center p-2 pb-0">
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
                                  <JanImage
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

                        {/* Remove button disabled while processing - outside overflow-hidden container */}
                        {!att.processing && (
                          <div
                            className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                            onClick={() => handleRemoveAttachment(idx)}
                          >
                            <IconX className="text-destructive-fg" size={16} />
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
            <TextareaAutosize
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
                  if (!streamingContent && prompt.trim()) {
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
                'bg-transparent pt-4 w-full flex-shrink-0 border-none resize-none outline-0 px-4',
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
                  'px-1 flex items-center w-full',
                  streamingContent && 'opacity-50 pointer-events-none'
                )}
              >
                {/* Hidden input for file selection - moved outside dropdown to persist during selection */}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  onChange={handleFileChange}
                />

                {/* Dropdown for attachments */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
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
                      <span>Add Images</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {model?.provider === 'llamacpp' && loadingModel ? (
                  <ModelLoader />
                ) : (
                  <DropdownModelProvider
                    model={model}
                    useLastUsedModel={initialMessage}
                  />
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

                {/* Browser Extension Tool Button - always show if model supports tools */}
                {selectedModel?.capabilities?.includes('tools') && BrowserToolComponent && (
                  <McpExtensionToolLoader
                    tools={tools}
                    hasActiveMCPServers={true} // Browser extension manages its own connection
                    selectedModelHasTools={
                      selectedModel?.capabilities?.includes('tools') ?? false
                    }
                    initialMessage={initialMessage}
                    MCPToolComponent={BrowserToolComponent}
                  />
                )}

                {selectedModel?.capabilities?.includes('tools') &&
                  hasActiveMCPServers &&
                  (MCPToolComponent ? (
                    // Use custom MCP component (Web Search)
                    <McpExtensionToolLoader
                      tools={tools}
                      hasActiveMCPServers={hasActiveMCPServers}
                      selectedModelHasTools={
                        selectedModel?.capabilities?.includes('tools') ?? false
                      }
                      initialMessage={initialMessage}
                      MCPToolComponent={MCPToolComponent}
                      deepResearchEnabled={deepResearchEnabled}
                    />
                  ) : (
                    // Use default tools dropdown
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
                                      'h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1 cursor-pointer relative',
                                      isOpen && 'bg-main-view-fg/10'
                                    )}
                                  >
                                    <IconTool
                                      size={18}
                                      className="text-main-view-fg/50"
                                    />
                                    {toolsCount > 0 && (
                                      <div className="absolute -top-2 -right-2 bg-accent text-accent-fg text-xs rounded-full size-5 flex items-center justify-center font-medium">
                                        <span className="leading-0 text-xs">
                                          {toolsCount > 99 ? '99+' : toolsCount}
                                        </span>
                                      </div>
                                    )}
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
                {/* Deep Research Button - Only shown for models with reasoning capability */}
                {modelSupportsReasoning && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onClick={toggleDeepResearch}
                          className={cn(
                            'h-7 flex items-center justify-center rounded-md transition-all duration-200 ease-in-out gap-1.5 cursor-pointer ml-1',
                            'px-1 md:px-2',
                            deepResearchEnabled
                              ? 'bg-accent/20 text-accent hover:bg-accent/30'
                              : 'hover:bg-main-view-fg/10'
                          )}
                        >
                          <IconZoomScan
                            size={18}
                            className={cn(
                              deepResearchEnabled
                                ? 'text-accent'
                                : 'text-main-view-fg/50'
                            )}
                          />
                          <span className={cn(
                            'text-sm font-medium hidden md:inline',
                            deepResearchEnabled
                              ? 'text-accent'
                              : 'text-main-view-fg/50'
                          )}>
                            {t('deepResearch')}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {deepResearchEnabled
                            ? t('deepResearchEnabled')
                            : t('deepResearchDisabled')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedProvider === 'llamacpp' &&
                hasActiveModels &&
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

              {streamingContent ? (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() =>
                    stopStreaming(currentThreadId ?? streamingContent.thread_id)
                  }
                >
                  <IconPlayerStopFilled />
                </Button>
              ) : (
                <Button
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
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="bg-main-view-fg/2 -mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-main-view-fg/30 cursor-pointer"
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
        hasActiveModels &&
        !tokenCounterCompact &&
        !initialMessage &&
        (threadMessages?.length > 0 || prompt.trim().length > 0) && (
          <div className="flex-1 w-full flex justify-start px-2">
            <TokenCounter
              messages={threadMessages || []}
              compact={false}
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
    </div>
  )
}

export default ChatInput

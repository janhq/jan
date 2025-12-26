/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/refs */
/* eslint-disable react-refresh/only-export-components */

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerTrigger,
} from '@/components/ui/dropdrawer'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ChatStatus, FileUIPart } from 'ai'
import {
  type UploadStatus,
  blobUrlToDataUrl,
  uploadMedia,
  createJanMediaUrl,
} from '@/services/media-upload-service'
import { CHAT_STATUS, UPLOAD_STATUS } from '@/constants'
import {
  ArrowUp,
  Loader2Icon,
  Paperclip,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
  AlertCircleIcon,
} from 'lucide-react'
import { nanoid } from 'nanoid'

// ============================================================================
// Extended FileUIPart Type (wrapper around AI SDK's FileUIPart)
// ============================================================================

/**
 * Extended FileUIPart that includes upload tracking fields.
 * We wrap the AI SDK's FileUIPart instead of modifying it.
 */
export type ExtendedFileUIPart = FileUIPart & {
  /** Jan media ID after successful upload */
  mediaId?: string
  /** Current upload status */
  uploadStatus?: UploadStatus
  /** Error message if upload failed */
  uploadError?: string
  /** Blob URL for local preview (separate from url which will contain jan media URL after upload) */
  previewUrl?: string
}
import {
  type ChangeEvent,
  type ChangeEventHandler,
  Children,
  type ClipboardEventHandler,
  type ComponentProps,
  createContext,
  type FormEvent,
  type FormEventHandler,
  Fragment,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// ============================================================================
// Provider Context & Types
// ============================================================================

export type AttachmentsContext = {
  files: (ExtendedFileUIPart & { id: string })[]
  add: (files: File[] | FileList) => void
  remove: (id: string) => void
  clear: () => void
  openFileDialog: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
  /** Update a file's upload status and mediaId */
  updateFile: (id: string, updates: Partial<ExtendedFileUIPart>) => void
}

export type TextInputContext = {
  value: string
  setInput: (v: string) => void
  clear: () => void
}

export type PromptInputControllerProps = {
  textInput: TextInputContext
  attachments: AttachmentsContext
  /** INTERNAL: Allows PromptInput to register its file textInput + "open" callback */
  __registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void
}

const PromptInputController = createContext<PromptInputControllerProps | null>(
  null
)
const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(
  null
)

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController)
  if (!ctx) {
    throw new Error(
      'Wrap your component inside <PromptInputProvider> to use usePromptInputController().'
    )
  }
  return ctx
}

// Optional variants (do NOT throw). Useful for dual-mode components.
const useOptionalPromptInputController = () => useContext(PromptInputController)

export const useProviderAttachments = () => {
  const ctx = useContext(ProviderAttachmentsContext)
  if (!ctx) {
    throw new Error(
      'Wrap your component inside <PromptInputProvider> to use useProviderAttachments().'
    )
  }
  return ctx
}

const useOptionalProviderAttachments = () =>
  useContext(ProviderAttachmentsContext)

export type PromptInputProviderProps = PropsWithChildren<{
  initialInput?: string
  maxImages?: number
  maxFileSize?: number
  accept?: string
  onError?: (err: {
    code: 'max_files' | 'max_file_size' | 'accept' | 'max_images'
    message: string
  }) => void
}>

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed.
 */
export function PromptInputProvider({
  initialInput: initialTextInput = '',
  maxImages = 10,
  maxFileSize,
  accept,
  onError,
  children,
}: PromptInputProviderProps) {
  // ----- textInput state
  const [textInput, setTextInput] = useState(initialTextInput)
  const clearInput = useCallback(() => setTextInput(''), [])

  // ----- attachments state (global when wrapped)
  const [attachmentFiles, setAttachmentFiles] = useState<
    (ExtendedFileUIPart & { id: string })[]
  >([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openRef = useRef<() => void>(() => {})

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === '') {
        return true
      }

      const patterns = accept
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      return patterns.some((pattern) => {
        if (pattern.endsWith('/*')) {
          const prefix = pattern.slice(0, -1)
          return f.type.startsWith(prefix)
        }
        return f.type === pattern
      })
    },
    [accept]
  )

  const add = useCallback(
    (files: File[] | FileList) => {
      const incoming = Array.from(files)
      if (incoming.length === 0) {
        return
      }

      // Validate file types
      const accepted = incoming.filter((f) => matchesAccept(f))
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: 'accept',
          message: 'Only JPEG and PNG images are supported.',
        })
        return
      }

      // Validate file sizes
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true
      const sized = accepted.filter(withinSize)
      if (accepted.length > 0 && sized.length === 0) {
        const maxSizeMB = maxFileSize
          ? Math.round(maxFileSize / 1024 / 1024)
          : 0
        onError?.({
          code: 'max_file_size',
          message: `File size must be under ${maxSizeMB}MB.`,
        })
        return
      }

      setAttachmentFiles((prev) => {
        // Count current images
        const currentImageCount = prev.filter((f) =>
          f.mediaType?.startsWith('image/')
        ).length

        // Separate incoming files into images and non-images
        const incomingImages = sized.filter((f) => f.type.startsWith('image/'))
        const incomingNonImages = sized.filter(
          (f) => !f.type.startsWith('image/')
        )

        // Check if adding these images would exceed the limit
        const totalImagesAfterAdd = currentImageCount + incomingImages.length

        if (totalImagesAfterAdd > maxImages) {
          onError?.({
            code: 'max_images',
            message: `You may only upload ${maxImages} files at a time.`,
          })
          // Don't add any files if limit would be exceeded
          return prev
        }

        // Combine images with non-images
        const filesToAdd = [...incomingImages, ...incomingNonImages]

        return prev.concat(
          filesToAdd.map((file) => {
            const blobUrl = URL.createObjectURL(file)
            return {
              id: nanoid(),
              type: 'file' as const,
              url: blobUrl,
              previewUrl: blobUrl,
              uploadStatus: UPLOAD_STATUS.PENDING,
              mediaType: file.type,
              filename: file.name,
            }
          })
        )
      })
    },
    [maxImages, maxFileSize, matchesAccept, onError]
  )

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((f) => f.id === id)
      if (found?.previewUrl) {
        URL.revokeObjectURL(found.previewUrl)
      }
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const f of prev) {
        if (f.previewUrl) {
          URL.revokeObjectURL(f.previewUrl)
        }
      }
      return []
    })
  }, [])

  const updateFile = useCallback(
    (id: string, updates: Partial<ExtendedFileUIPart>) => {
      setAttachmentFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
      )
    },
    []
  )

  // Keep a ref to attachments for cleanup on unmount (avoids stale closure)
  const attachmentsRef = useRef(attachmentFiles)
  attachmentsRef.current = attachmentFiles

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      for (const f of attachmentsRef.current) {
        if (f.previewUrl) {
          URL.revokeObjectURL(f.previewUrl)
        }
      }
    }
  }, [])

  const openFileDialog = useCallback(() => {
    openRef.current?.()
  }, [])

  const attachments = useMemo<AttachmentsContext>(
    () => ({
      files: attachmentFiles,
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef,
      updateFile,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog, updateFile]
  )

  const __registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current
      openRef.current = open
    },
    []
  )

  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      textInput: {
        value: textInput,
        setInput: setTextInput,
        clear: clearInput,
      },
      attachments,
      __registerFileInput,
    }),
    [textInput, clearInput, attachments, __registerFileInput]
  )

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  )
}

// ============================================================================
// Component Context & Hooks
// ============================================================================

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null)

export const usePromptInputAttachments = () => {
  // Dual-mode: prefer provider if present, otherwise use local
  const provider = useOptionalProviderAttachments()
  const local = useContext(LocalAttachmentsContext)
  const context = provider ?? local
  if (!context) {
    throw new Error(
      'usePromptInputAttachments must be used within a PromptInput or PromptInputProvider'
    )
  }
  return context
}

/**
 * Hook to check if any attachments are currently uploading or pending.
 * Useful for disabling submit button during uploads.
 */
export const usePromptInputIsUploading = () => {
  const attachments = usePromptInputAttachments()
  return attachments.files.some(
    (f) => f.uploadStatus === UPLOAD_STATUS.PENDING || f.uploadStatus === UPLOAD_STATUS.UPLOADING
  )
}

/**
 * Hook to check if any attachments have failed to upload.
 */
export const usePromptInputHasFailedUploads = () => {
  const attachments = usePromptInputAttachments()
  return attachments.files.some((f) => f.uploadStatus === UPLOAD_STATUS.FAILED)
}

export type PromptInputAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: ExtendedFileUIPart & { id: string }
  className?: string
}

export function PromptInputAttachment({
  data,
  className,
  ...props
}: PromptInputAttachmentProps) {
  const attachments = usePromptInputAttachments()

  const filename = data.filename || ''

  // Use previewUrl for display, fall back to url
  const displayUrl = data.previewUrl || data.url

  const mediaType =
    data.mediaType?.startsWith('image/') && displayUrl ? 'image' : 'file'
  const isImage = mediaType === 'image'

  const attachmentLabel = filename || (isImage ? 'Image' : 'Attachment')

  const isUploading = data.uploadStatus === UPLOAD_STATUS.UPLOADING
  const isCompleted = data.uploadStatus === UPLOAD_STATUS.COMPLETED
  const isFailed = data.uploadStatus === UPLOAD_STATUS.FAILED

  // Retry failed upload
  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation()
    attachments.updateFile(data.id, {
      uploadStatus: UPLOAD_STATUS.PENDING,
      uploadError: undefined,
    })
  }

  return (
    <PromptInputHoverCard>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            'group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-sm transition-all hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
            isFailed && 'border-destructive/50 bg-destructive/10',
            className
          )}
          key={data.id}
          {...props}
        >
          <div className="relative size-5 shrink-0">
            <div className="absolute inset-0 flex size-5 items-center justify-center overflow-hidden rounded bg-background transition-opacity group-hover:opacity-0">
              {isUploading ? (
                <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
              ) : isCompleted ? (
                isImage ? (
                  <img
                    alt={filename || 'attachment'}
                    className="size-5 object-cover"
                    height={20}
                    src={displayUrl}
                    width={20}
                  />
                ) : (
                  <div className="flex size-5 items-center justify-center text-muted-foreground">
                    <PaperclipIcon className="size-3" />
                  </div>
                )
              ) : isFailed ? (
                <AlertCircleIcon className="size-3 text-destructive" />
              ) : isImage ? (
                <img
                  alt={filename || 'attachment'}
                  className="size-5 object-cover"
                  height={20}
                  src={displayUrl}
                  width={20}
                />
              ) : (
                <div className="flex size-5 items-center justify-center text-muted-foreground">
                  <PaperclipIcon className="size-3" />
                </div>
              )}
            </div>
            {isFailed ? (
              <Button
                aria-label="Retry upload"
                className="absolute inset-0 size-5 cursor-pointer rounded p-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [&>svg]:size-2.5"
                onClick={handleRetry}
                type="button"
                variant="ghost"
              >
                <ArrowUp />
                <span className="sr-only">Retry</span>
              </Button>
            ) : (
              <Button
                aria-label="Remove attachment"
                className="absolute inset-0 size-5 cursor-pointer rounded p-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [&>svg]:size-2.5"
                onClick={(e) => {
                  e.stopPropagation()
                  attachments.remove(data.id)
                }}
                type="button"
                variant="ghost"
              >
                <XIcon />
                <span className="sr-only">Remove</span>
              </Button>
            )}
          </div>

          <span className="flex-1 truncate">{attachmentLabel}</span>
          {isUploading && (
            <span className="text-xs text-muted-foreground">Uploading...</span>
          )}
          {isFailed && <span className="text-xs text-destructive">Failed</span>}
        </div>
      </HoverCardTrigger>
      <PromptInputHoverCardContent className="w-auto p-2">
        <div className="w-auto space-y-3">
          {isImage && displayUrl && (
            <div className="flex max-h-96 w-96 items-center justify-center overflow-hidden rounded-md border">
              <img
                alt={filename || 'attachment preview'}
                className="max-h-full max-w-full object-contain"
                height={384}
                src={displayUrl}
                width={448}
              />
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1 space-y-1 px-0.5">
              <h4 className="truncate font-semibold text-sm leading-none">
                {filename || (isImage ? 'Image' : 'Attachment')}
              </h4>
              {data.mediaType && (
                <p className="truncate font-mono text-muted-foreground text-xs">
                  {data.mediaType}
                </p>
              )}
              {data.uploadStatus && (
                <p className="truncate font-mono text-muted-foreground text-xs">
                  Status: {data.uploadStatus}
                  {data.mediaId && ` (${data.mediaId})`}
                </p>
              )}
              {data.uploadError && (
                <p className="truncate font-mono text-destructive text-xs">
                  Error: {data.uploadError}
                </p>
              )}
            </div>
          </div>
        </div>
      </PromptInputHoverCardContent>
    </PromptInputHoverCard>
  )
}

export type PromptInputAttachmentsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> & {
  children: (attachment: ExtendedFileUIPart & { id: string }) => ReactNode
}

export function PromptInputAttachments({
  children,
  className,
  ...props
}: PromptInputAttachmentsProps) {
  const attachments = usePromptInputAttachments()

  if (!attachments.files.length) {
    return null
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 p-3 w-full', className)}
      {...props}
    >
      {attachments.files.map((file) => (
        <Fragment key={file.id}>{children(file)}</Fragment>
      ))}
    </div>
  )
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropDrawerItem
> & {
  label?: string
}

export const PromptInputActionAddAttachments = ({
  label = 'Add photos or files',
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments()

  return (
    <DropDrawerItem
      {...props}
      onSelect={(e) => {
        e.preventDefault()
        attachments.openFileDialog()
      }}
    >
      <div className="flex gap-2 items-center">
        <Paperclip className="size-4 text-muted-foreground" /> {label}
      </div>
    </DropDrawerItem>
  )
}

export type PromptInputMessage = {
  text: string
  files: ExtendedFileUIPart[]
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  'onSubmit' | 'onError'
> & {
  accept?: string // e.g., "image/*" or leave undefined for any
  multiple?: boolean
  /** User ID for media upload tracking (e.g., conversation ID) */
  userId?: string
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean
  // Minimal constraints
  maxFiles?: number
  maxImages?: number // Maximum number of images allowed (default: 10)
  maxFileSize?: number // Maximum file size in bytes (e.g., 10MB = 10 * 1024 * 1024)
  onError?: (err: {
    code: 'max_files' | 'max_file_size' | 'accept' | 'max_images'
    message: string
  }) => void
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>
}

export const PromptInput = ({
  className,
  accept,
  multiple,
  userId,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxImages = 10,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  // Try to use a provider controller if present
  const controller = useOptionalPromptInputController()
  const usingProvider = !!controller

  // Refs
  const inputRef = useRef<HTMLInputElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  // Track which files are currently being uploaded to prevent duplicate uploads
  const uploadingFilesRef = useRef<Set<string>>(new Set())
  // Track abort controllers for cleanup
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  // ----- Local attachments (only used when no provider)
  const [items, setItems] = useState<(ExtendedFileUIPart & { id: string })[]>(
    []
  )
  const files = usingProvider ? controller.attachments.files : items

  // Keep a ref to files for cleanup on unmount (avoids stale closure)
  const filesRef = useRef(files)
  filesRef.current = files

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === '') {
        return true
      }

      const patterns = accept
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      return patterns.some((pattern) => {
        if (pattern.endsWith('/*')) {
          const prefix = pattern.slice(0, -1) // e.g: image/* -> image/
          return f.type.startsWith(prefix)
        }
        return f.type === pattern
      })
    },
    [accept]
  )

  const addLocal = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = Array.from(fileList)
      const accepted = incoming.filter((f) => matchesAccept(f))
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: 'accept',
          message: 'Only JPEG and PNG images are supported.',
        })
        return
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true
      const sized = accepted.filter(withinSize)
      if (accepted.length > 0 && sized.length === 0) {
        const maxSizeMB = maxFileSize
          ? Math.round(maxFileSize / 1024 / 1024)
          : 0
        onError?.({
          code: 'max_file_size',
          message: `File size must be under ${maxSizeMB}MB.`,
        })
        return
      }

      setItems((prev) => {
        // Count current images
        const currentImageCount = prev.filter((f) =>
          f.mediaType?.startsWith('image/')
        ).length

        // Separate incoming files into images and non-images
        const incomingImages = sized.filter((f) => f.type.startsWith('image/'))
        const incomingNonImages = sized.filter(
          (f) => !f.type.startsWith('image/')
        )

        // Check if adding these images would exceed the limit
        const totalImagesAfterAdd = currentImageCount + incomingImages.length

        if (totalImagesAfterAdd > maxImages) {
          onError?.({
            code: 'max_images',
            message: `You may only upload ${maxImages} files at a time.`,
          })
          // Don't add any files if limit would be exceeded
          return prev
        }

        // Combine images with non-images
        const filesToAdd = [...incomingImages, ...incomingNonImages]

        // Apply overall maxFiles limit if specified
        const capacity =
          typeof maxFiles === 'number'
            ? Math.max(0, maxFiles - prev.length)
            : undefined
        const capped =
          typeof capacity === 'number'
            ? filesToAdd.slice(0, capacity)
            : filesToAdd

        if (typeof capacity === 'number' && filesToAdd.length > capacity) {
          onError?.({
            code: 'max_files',
            message: 'Too many files. Some were not added.',
          })
        }

        const next: (ExtendedFileUIPart & { id: string })[] = []
        for (const file of capped) {
          const blobUrl = URL.createObjectURL(file)
          next.push({
            id: nanoid(),
            type: 'file',
            url: blobUrl,
            previewUrl: blobUrl,
            uploadStatus: UPLOAD_STATUS.PENDING,
            mediaType: file.type,
            filename: file.name,
          })
        }
        return prev.concat(next)
      })
    },
    [matchesAccept, maxFiles, maxImages, maxFileSize, onError]
  )

  const removeLocal = useCallback(
    (id: string) =>
      setItems((prev) => {
        const found = prev.find((file) => file.id === id)
        if (found?.previewUrl) {
          URL.revokeObjectURL(found.previewUrl)
        }
        return prev.filter((file) => file.id !== id)
      }),
    []
  )

  const clearLocal = useCallback(
    () =>
      setItems((prev) => {
        for (const file of prev) {
          if (file.previewUrl) {
            URL.revokeObjectURL(file.previewUrl)
          }
        }
        return []
      }),
    []
  )

  const updateFileLocal = useCallback(
    (id: string, updates: Partial<ExtendedFileUIPart>) => {
      setItems((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
      )
    },
    []
  )

  const add = usingProvider ? controller.attachments.add : addLocal
  const remove = usingProvider ? controller.attachments.remove : removeLocal
  const clear = usingProvider ? controller.attachments.clear : clearLocal
  const updateFile = usingProvider
    ? controller.attachments.updateFile
    : updateFileLocal
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : openFileDialogLocal

  // Let provider know about our hidden file input so external menus can call openFileDialog()
  useEffect(() => {
    if (!usingProvider) return
    controller.__registerFileInput(inputRef, () => inputRef.current?.click())
  }, [usingProvider, controller])

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = ''
    }
  }, [files, syncHiddenInput])

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    if (globalDrop) return // when global drop is on, let the document-level handler own drops

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files)
      }
    }
    form.addEventListener('dragover', onDragOver)
    form.addEventListener('drop', onDrop)
    return () => {
      form.removeEventListener('dragover', onDragOver)
      form.removeEventListener('drop', onDrop)
    }
  }, [add, globalDrop])

  useEffect(() => {
    if (!globalDrop) return

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files)
      }
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [add, globalDrop])

  useEffect(
    () => () => {
      if (!usingProvider) {
        for (const f of filesRef.current) {
          if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
        }
      }
    },

    [usingProvider]
  )

  // Upload pending files automatically
  useEffect(() => {
    const pendingFiles = files.filter(
      (f) =>
        f.uploadStatus === UPLOAD_STATUS.PENDING && !uploadingFilesRef.current.has(f.id)
    )
    if (pendingFiles.length === 0) return

    pendingFiles.forEach((file) => {
      // Mark as being uploaded in ref (to prevent duplicate uploads)
      uploadingFilesRef.current.add(file.id)

      const abortController = new AbortController()
      abortControllersRef.current.set(file.id, abortController)

      // Mark as uploading in state
      updateFile(file.id, { uploadStatus: UPLOAD_STATUS.UPLOADING })

      // Start async upload (not awaited to avoid blocking)
      ;(async () => {
        try {
          // Convert blob URL to data URL for upload
          if (!file.previewUrl) {
            throw new Error('No preview URL available')
          }
          const dataUrl = await blobUrlToDataUrl(file.previewUrl)

          // Upload to media service
          const response = await uploadMedia(
            dataUrl,
            file.filename || 'attachment',
            userId || 'anonymous',
            abortController.signal
          )

          // Update file with media ID and jan media URL
          // Use jan media URL format (data:image/jpeg;jan_MEDIA_ID) for server to resolve
          const janMediaUrl = createJanMediaUrl(response.id, response.mime)
          updateFile(file.id, {
            mediaId: response.id,
            url: janMediaUrl,
            uploadStatus: UPLOAD_STATUS.COMPLETED,
          })
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            // Upload was cancelled, don't update status
            return
          }
          console.error('Upload failed:', error)
          updateFile(file.id, {
            uploadStatus: 'failed',
            uploadError:
              error instanceof Error ? error.message : 'Upload failed',
          })
        } finally {
          // Cleanup refs
          uploadingFilesRef.current.delete(file.id)
          abortControllersRef.current.delete(file.id)
        }
      })()
    })
  }, [files, updateFile, userId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((controller) => controller.abort())
      abortControllersRef.current.clear()
      uploadingFilesRef.current.clear()
    }
  }, [])

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) {
      add(event.currentTarget.files)
    }
    // Reset input value to allow selecting files that were previously removed
    event.currentTarget.value = ''
  }

  const ctx = useMemo<AttachmentsContext>(
    () => ({
      files: files.map((item) => ({ ...item, id: item.id })),
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef: inputRef,
      updateFile,
    }),
    [files, add, remove, clear, openFileDialog, updateFile]
  )

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()

    // Block submission if any files are still uploading or pending
    const hasIncompleteUploads = files.some(
      (f) => f.uploadStatus === UPLOAD_STATUS.PENDING || f.uploadStatus === UPLOAD_STATUS.UPLOADING
    )
    if (hasIncompleteUploads) {
      console.warn('Cannot submit while files are uploading')
      return
    }

    // Block submission if any files failed to upload
    const hasFailedUploads = files.some((f) => f.uploadStatus === UPLOAD_STATUS.FAILED)
    if (hasFailedUploads) {
      console.warn(
        'Cannot submit with failed uploads. Please retry or remove the failed files.'
      )
      return
    }

    const form = event.currentTarget
    const text = usingProvider
      ? controller.textInput.value
      : (() => {
          const formData = new FormData(form)
          return (formData.get('message') as string) || ''
        })()

    // Reset form immediately after capturing text to avoid race condition
    // where user input during async blob conversion would be lost
    if (!usingProvider) {
      form.reset()
    }

    // Files already have jan media URLs from successful uploads - no conversion needed
    // Just strip internal fields (id, uploadStatus, etc.) before sending
    const submittableFiles: ExtendedFileUIPart[] = files.map(
      ({ id, uploadStatus, uploadError, previewUrl, ...rest }) => rest
    )

    try {
      const trimmedText = text.trim()
      const result = onSubmit(
        { text: trimmedText, files: submittableFiles },
        event
      )

      // Handle both sync and async onSubmit
      if (result instanceof Promise) {
        result
          .then(() => {
            clear()
            if (usingProvider) {
              controller.textInput.clear()
            }
          })
          .catch(() => {
            // Don't clear on error - user may want to retry
          })
      } else {
        // Sync function completed without throwing, clear attachments
        clear()
        if (usingProvider) {
          controller.textInput.clear()
        }
      }
    } catch {
      // Don't clear on error - user may want to retry
    }
  }

  // Render with or without local provider
  const inner = (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn('w-full', className)}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup className="overflow-hidden rounded-3xl p-1 pb-0">
          {children}
        </InputGroup>
      </form>
    </>
  )

  return usingProvider ? (
    inner
  ) : (
    <LocalAttachmentsContext.Provider value={ctx}>
      {inner}
    </LocalAttachmentsContext.Provider>
  )
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn('contents', className)} {...props} />
)

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = 'Ask Jan ...',
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalPromptInputController()
  const attachments = usePromptInputAttachments()
  const [isComposing, setIsComposing] = useState(false)

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter') {
      if (isComposing || e.nativeEvent.isComposing) {
        return
      }
      if (e.shiftKey) {
        return
      }
      e.preventDefault()

      // Check if the submit button is disabled before submitting
      const form = e.currentTarget.form
      const submitButton = form?.querySelector(
        'button[type="submit"]'
      ) as HTMLButtonElement | null
      if (submitButton?.disabled) {
        return
      }

      form?.requestSubmit()
    }

    // Remove last attachment when Backspace is pressed and textarea is empty
    if (
      e.key === 'Backspace' &&
      e.currentTarget.value === '' &&
      attachments.files.length > 0
    ) {
      e.preventDefault()
      const lastAttachment = attachments.files.at(-1)
      if (lastAttachment) {
        attachments.remove(lastAttachment.id)
      }
    }
  }

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const items = event.clipboardData?.items

    if (!items) {
      return
    }

    const files: File[] = []

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) {
          files.push(file)
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault()
      attachments.add(files)
    }
  }

  const controlledProps = controller
    ? {
        value: controller.textInput.value,
        onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
          controller.textInput.setInput(e.currentTarget.value)
          onChange?.(e)
        },
      }
    : {
        onChange,
      }

  return (
    <InputGroupTextarea
      className={cn('field-sizing-content max-h-48 min-h-16', className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
      {...controlledProps}
    />
  )
}

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  'align'
>

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn('order-first flex-wrap gap-1', className)}
    {...props}
  />
)

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  'align'
>

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn('justify-between gap-1', className)}
    {...props}
  />
)

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div className={cn('flex items-center gap-1', className)} {...props} />
)

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    size ?? (Children.count(props.children) > 1 ? 'sm' : 'icon-sm')

  return (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  )
}

export type PromptInputActionMenuProps = ComponentProps<typeof DropDrawer>
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropDrawer {...props} />
)

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropDrawerTrigger asChild>
    <PromptInputButton className={className} {...props}>
      {children ?? <PlusIcon className="size-4 text-muted-foreground" />}
    </PromptInputButton>
  </DropDrawerTrigger>
)

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropDrawerContent
>
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropDrawerContent align="start" className={cn(className)} {...props} />
)

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropDrawerItem
>
export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => (
  <DropDrawerItem className={cn(className)} {...props} />
)

// Note: Actions that perform side-effects (like opening a file dialog)
// are provided in opt-in modules (e.g., prompt-input-attachments).

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus
}

export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon-sm',
  status,
  disabled,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isUploading = usePromptInputIsUploading()
  const hasFailedUploads = usePromptInputHasFailedUploads()
  const controller = useOptionalPromptInputController()
  const attachments = usePromptInputAttachments()

  let Icon = <ArrowUp className="size-4" />

  if (isUploading) {
    Icon = <Loader2Icon className="size-4 animate-spin" />
  } else if (status === CHAT_STATUS.SUBMITTED || status === CHAT_STATUS.STREAMING) {
    Icon = <SquareIcon className="size-4" />
  }

  const trimmedText = controller?.textInput.value?.trim() ?? ''
  const hasContent = trimmedText.length > 0 || attachments.files.length > 0
  // Keep stop-action clickable while streaming or submitted even when the input was cleared
  const isDisabled =
    disabled ||
    isUploading ||
    hasFailedUploads ||
    (!hasContent && status !== CHAT_STATUS.STREAMING && status !== CHAT_STATUS.SUBMITTED)

  return (
    <InputGroupButton
      aria-label="Submit"
      className={cn(className)}
      size={size}
      type="submit"
      variant={variant}
      disabled={isDisabled}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  )
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null
  onend: ((this: SpeechRecognition, ev: Event) => any) | null
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any)
    | null
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any)
    | null
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

type SpeechRecognitionResultList = {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

type SpeechRecognitionResult = {
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

type SpeechRecognitionAlternative = {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition
    }
    webkitSpeechRecognition: {
      new (): SpeechRecognition
    }
  }
}

export type PromptInputSpeechButtonProps = ComponentProps<
  typeof PromptInputButton
> & {
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onTranscriptionChange?: (text: string) => void
}

export const PromptInputSpeechButton = ({
  className,
  textareaRef,
  onTranscriptionChange,
  ...props
}: PromptInputSpeechButtonProps) => {
  const [isListening, setIsListening] = useState(false)
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    ) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition
      const speechRecognition = new SpeechRecognition()

      speechRecognition.continuous = true
      speechRecognition.interimResults = true
      speechRecognition.lang = 'en-US'

      speechRecognition.onstart = () => {
        setIsListening(true)
      }

      speechRecognition.onend = () => {
        setIsListening(false)
      }

      speechRecognition.onresult = (event) => {
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            finalTranscript += result[0]?.transcript ?? ''
          }
        }

        if (finalTranscript && textareaRef?.current) {
          const textarea = textareaRef.current
          const currentValue = textarea.value
          const newValue =
            currentValue + (currentValue ? ' ' : '') + finalTranscript

          textarea.value = newValue
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          onTranscriptionChange?.(newValue)
        }
      }

      speechRecognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        setIsListening(false)
      }

      recognitionRef.current = speechRecognition
      setRecognition(speechRecognition)
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [textareaRef, onTranscriptionChange])

  const toggleListening = useCallback(() => {
    if (!recognition) {
      return
    }

    if (isListening) {
      recognition.stop()
    } else {
      recognition.start()
    }
  }, [recognition, isListening])

  return (
    <PromptInputButton
      className={cn(
        'relative transition-all duration-200 rounded-full',
        isListening && 'animate-pulse bg-accent text-accent-foreground',
        className
      )}
      disabled={!recognition}
      onClick={toggleListening}
      {...props}
    >
      <MicIcon className="size-4 text-muted-foreground" />
    </PromptInputButton>
  )
}

export type PromptInputSelectProps = ComponentProps<typeof Select>

export const PromptInputSelect = (props: PromptInputSelectProps) => (
  <Select {...props} />
)

export type PromptInputSelectTriggerProps = ComponentProps<typeof SelectTrigger>

export const PromptInputSelectTrigger = ({
  className,
  ...props
}: PromptInputSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
      'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
      className
    )}
    {...props}
  />
)

export type PromptInputSelectContentProps = ComponentProps<typeof SelectContent>

export const PromptInputSelectContent = ({
  className,
  ...props
}: PromptInputSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
)

export type PromptInputSelectItemProps = ComponentProps<typeof SelectItem>

export const PromptInputSelectItem = ({
  className,
  ...props
}: PromptInputSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
)

export type PromptInputSelectValueProps = ComponentProps<typeof SelectValue>

export const PromptInputSelectValue = ({
  className,
  ...props
}: PromptInputSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
)

export type PromptInputHoverCardProps = ComponentProps<typeof HoverCard>

export const PromptInputHoverCard = ({
  openDelay = 0,
  closeDelay = 0,
  ...props
}: PromptInputHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
)

export type PromptInputHoverCardTriggerProps = ComponentProps<
  typeof HoverCardTrigger
>

export const PromptInputHoverCardTrigger = (
  props: PromptInputHoverCardTriggerProps
) => <HoverCardTrigger {...props} />

export type PromptInputHoverCardContentProps = ComponentProps<
  typeof HoverCardContent
>

export const PromptInputHoverCardContent = ({
  align = 'start',
  ...props
}: PromptInputHoverCardContentProps) => (
  <HoverCardContent align={align} {...props} />
)

export type PromptInputTabsListProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTabsList = ({
  className,
  ...props
}: PromptInputTabsListProps) => <div className={cn(className)} {...props} />

export type PromptInputTabProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTab = ({
  className,
  ...props
}: PromptInputTabProps) => <div className={cn(className)} {...props} />

export type PromptInputTabLabelProps = HTMLAttributes<HTMLHeadingElement>

export const PromptInputTabLabel = ({
  className,
  ...props
}: PromptInputTabLabelProps) => (
  <h3
    className={cn(
      'mb-2 px-3 font-medium text-muted-foreground text-xs',
      className
    )}
    {...props}
  />
)

export type PromptInputTabBodyProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTabBody = ({
  className,
  ...props
}: PromptInputTabBodyProps) => (
  <div className={cn('space-y-1', className)} {...props} />
)

export type PromptInputTabItemProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTabItem = ({
  className,
  ...props
}: PromptInputTabItemProps) => (
  <div
    className={cn(
      'flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent',
      className
    )}
    {...props}
  />
)

export type PromptInputCommandProps = ComponentProps<typeof Command>

export const PromptInputCommand = ({
  className,
  ...props
}: PromptInputCommandProps) => <Command className={cn(className)} {...props} />

export type PromptInputCommandInputProps = ComponentProps<typeof CommandInput>

export const PromptInputCommandInput = ({
  className,
  ...props
}: PromptInputCommandInputProps) => (
  <CommandInput className={cn(className)} {...props} />
)

export type PromptInputCommandListProps = ComponentProps<typeof CommandList>

export const PromptInputCommandList = ({
  className,
  ...props
}: PromptInputCommandListProps) => (
  <CommandList className={cn(className)} {...props} />
)

export type PromptInputCommandEmptyProps = ComponentProps<typeof CommandEmpty>

export const PromptInputCommandEmpty = ({
  className,
  ...props
}: PromptInputCommandEmptyProps) => (
  <CommandEmpty className={cn(className)} {...props} />
)

export type PromptInputCommandGroupProps = ComponentProps<typeof CommandGroup>

export const PromptInputCommandGroup = ({
  className,
  ...props
}: PromptInputCommandGroupProps) => (
  <CommandGroup className={cn(className)} {...props} />
)

export type PromptInputCommandItemProps = ComponentProps<typeof CommandItem>

export const PromptInputCommandItem = ({
  className,
  ...props
}: PromptInputCommandItemProps) => (
  <CommandItem className={cn(className)} {...props} />
)

export type PromptInputCommandSeparatorProps = ComponentProps<
  typeof CommandSeparator
>

export const PromptInputCommandSeparator = ({
  className,
  ...props
}: PromptInputCommandSeparatorProps) => (
  <CommandSeparator className={cn(className)} {...props} />
)

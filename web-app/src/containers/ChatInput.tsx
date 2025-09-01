'use client'

import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ArrowRight } from 'lucide-react'
import {
  IconWorld,
  IconAtom,
  IconTool,
  IconCodeCircle2,
  IconPlayerStopFilled,
  IconX,
  IconPaperclip,
  IconFileText,
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
import { getConnectedServers } from '@/services/mcp'
import { checkMmprojExists } from '@/services/models'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
}

function ChatInput({ model, className, initialMessage }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const {
    streamingContent,
    abortControllers,
    loadingModel,
    tools,
    cancelToolCall,
  } = useAppState()
  const { prompt, setPrompt } = usePrompt()
  const { currentThreadId } = useThreads()
  const { t } = useTranslation()
  const { spellCheckChatInput } = useGeneralSetting()

  const maxRows = 10

  const { selectedModel, selectedProvider } = useModelProvider()
  const { sendMessage } = useChat()
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipToolsAvailable, setTooltipToolsAvailable] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{
      name: string
      type: string
      size: number
      base64?: string
      dataUrl?: string
      textContent?: string
      isTextFile?: boolean
    }>
  >([]);
  const [connectedServers, setConnectedServers] = useState<string[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [hasMmproj, setHasMmproj] = useState(false)

  // Check for connected MCP servers
  useEffect(() => {
    const checkConnectedServers = async () => {
      try {
        const servers = await getConnectedServers()
        setConnectedServers(servers)
      } catch (error) {
        console.error('Failed to get connected servers:', error)
        setConnectedServers([])
      }
    }

    checkConnectedServers()

    // Poll for connected servers every 3 seconds
    const intervalId = setInterval(checkConnectedServers, 3000)

    return () => clearInterval(intervalId)
  }, [])

  // Check for mmproj existence or vision capability when model changes
  useEffect(() => {
    const checkMmprojSupport = async () => {
      if (selectedModel?.id) {
        try {
          // Only check mmproj for llamacpp provider
          if (selectedProvider === 'llamacpp') {
            const hasLocalMmproj = await checkMmprojExists(selectedModel.id)
            setHasMmproj(hasLocalMmproj)
          }
          // For non-llamacpp providers, only check vision capability
          else if (
            selectedProvider !== 'llamacpp' &&
            selectedModel?.capabilities?.includes('vision')
          ) {
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
  }, [selectedModel?.capabilities, selectedModel?.id, selectedProvider])

  // Check if there are active MCP servers
  const hasActiveMCPServers = connectedServers.length > 0 || tools.length > 0

  const handleSendMesage = (prompt: string) => {
    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }
    if (!prompt.trim() && uploadedFiles.length === 0) {
      return
    }
    setMessage('')
    sendMessage(
      prompt,
      true,
      uploadedFiles.length > 0 ? uploadedFiles : undefined
    )
    setUploadedFiles([])
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

  const handleAttachmentClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveFile = (indexToRemove: number) => {
    setUploadedFiles((prev) =>
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
      case 'txt':
        return 'text/plain'
      case 'csv':
        return 'text/csv'
      case 'json':
        return 'application/json'
      case 'md':
      case 'markdown':
        return 'text/markdown'
      case 'xml':
        return 'application/xml'
      case 'yaml':
      case 'yml':
        return 'application/x-yaml'
      case 'js':
        return 'text/javascript'
      case 'ts':
        return 'text/typescript'
      case 'py':
        return 'text/x-python'
      case 'html':
        return 'text/html'
      case 'css':
        return 'text/css'
      default:
        return ''
    }
  }

  const isTextFile = (mimeType: string): boolean => {
    const textTypes = [
      'text/plain',
      'text/csv',
      'application/json',
      'text/markdown',
      'application/xml',
      'application/x-yaml',
      'text/javascript',
      'text/typescript',
      'text/x-python',
      'text/html',
      'text/css'
    ]
    return textTypes.includes(mimeType) || mimeType.startsWith('text/')
  }

  const isImageFile = (mimeType: string): boolean => {
    return mimeType.startsWith('image/')
  }

  const validateFileSize = (file: File): boolean => {
    const maxSize = 10 * 1024 * 1024 // 10MB for images
    const maxTextSize = 1 * 1024 * 1024 // 1MB for text files
    const detectedType = file.type || getFileTypeFromExtension(file.name)
    
    if (isTextFile(detectedType)) {
      return file.size <= maxTextSize
    } else if (isImageFile(detectedType)) {
      return file.size <= maxSize
    }
    return false
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files

    if (files && files.length > 0) {
      const newFiles: Array<{
        name: string
        type: string
        size: number
        base64?: string
        dataUrl?: string
        textContent?: string
        isTextFile?: boolean
      }> = []

      Array.from(files).forEach((file) => {
        // Check file size
        if (!validateFileSize(file)) {
          const detectedType = file.type || getFileTypeFromExtension(file.name)
          const maxSizeText = isTextFile(detectedType) ? '1MB' : '10MB'
          setMessage(`File "${file.name}" is too large. Maximum size is ${maxSizeText}.`)
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
          return
        }

        // Get file type - use extension as fallback if MIME type is incorrect
        const detectedType = file.type || getFileTypeFromExtension(file.name)
        const actualType = getFileTypeFromExtension(file.name) || detectedType

        // Check file type - support both images and text files
        const allowedImageTypes = ['image/jpg', 'image/jpeg', 'image/png']
        const allowedTextTypes = [
          'text/plain',
          'text/csv', 
          'application/json',
          'text/markdown',
          'application/xml',
          'application/x-yaml',
          'text/javascript',
          'text/typescript',
          'text/x-python',
          'text/html',
          'text/css'
        ]

        const isValidImageFile = allowedImageTypes.includes(actualType)
        const isValidTextFile = allowedTextTypes.includes(actualType) || actualType.startsWith('text/')

        if (!isValidImageFile && !isValidTextFile) {
          setMessage(
            `File type "${actualType}" not supported. Supported formats: Images (JPEG, PNG) and Text files (TXT, CSV, JSON, MD, XML, YAML, JS, TS, PY, HTML, CSS).`
          )
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
          return
        }

        if (isValidTextFile) {
          // Handle text files
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result
            if (typeof result === 'string') {
              try {
                // Validate text content
                if (result.length > 100000) { // 100KB text limit
                  setMessage(`Text file "${file.name}" content is too large. Maximum text content is 100KB.`)
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
                  }
                  return
                }

                const fileData = {
                  name: file.name,
                  size: file.size,
                  type: actualType,
                  textContent: result,
                  isTextFile: true,
                }
                newFiles.push(fileData)
                
                // Update state when all files are processed
                if (newFiles.length === Array.from(files).filter(f => {
                  const fType = getFileTypeFromExtension(f.name) || f.type
                  return validateFileSize(f) && (allowedImageTypes.includes(fType) || allowedTextTypes.includes(fType) || fType.startsWith('text/'))
                }).length) {
                  setUploadedFiles((prev) => {
                    const updated = [...prev, ...newFiles]
                    return updated
                  })
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
                    setMessage('')
                  }
                }
              } catch (error) {
                setMessage(`Error reading file "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`)
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }
            }
          }
          reader.onerror = () => {
            setMessage(`Error reading file "${file.name}"`)
            if (fileInputRef.current) {
              fileInputRef.current.value = ''
            }
          }
          reader.readAsText(file)
        } else if (isValidImageFile) {
          // Handle image files (existing logic)
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result
            if (typeof result === 'string') {
              const base64String = result.split(',')[1]
              const fileData = {
                name: file.name,
                size: file.size,
                type: actualType,
                base64: base64String,
                dataUrl: result,
                isTextFile: false,
              }
              newFiles.push(fileData)
              
              // Update state when all files are processed
              if (newFiles.length === Array.from(files).filter(f => {
                const fType = getFileTypeFromExtension(f.name) || f.type
                return validateFileSize(f) && (allowedImageTypes.includes(fType) || allowedTextTypes.includes(fType) || fType.startsWith('text/'))
              }).length) {
                setUploadedFiles((prev) => {
                  const updated = [...prev, ...newFiles]
                  return updated
                })
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                  setMessage('')
                }
              }
            }
          }
          reader.readAsDataURL(file)
        }
      })
    }

    if (textareaRef.current) {
      textareaRef.current.focus()
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
    // Only allow paste if model supports mmproj
    if (!hasMmproj) {
      return
    }

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
    if (navigator.clipboard && 'read' in navigator.clipboard) {
      e.preventDefault()

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

    // If we reach here, no image was found or processed
    if (!hasProcessedImage) {
      console.log('No image data found in clipboard or clipboard access failed')
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <div
          className={cn(
            'relative flex flex-col gap-2 rounded-lg border border-main-view-fg/20 bg-main-view-bg p-3 transition-all duration-200 ease-in-out',
            className,
            isDragOver && 'border-blue-500 bg-blue-50/10',
            isFocused && 'ring-1 ring-main-view-fg/10',
            isDragOver && 'ring-2 ring-accent'
          )}
          data-drop-zone="true"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {streamingContent && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg">
              <MovingBorder rx="10%" ry="10%">
                <div
                  className={cn(
                    // small, clipped glow that travels along the border only
                    'size-10 rounded-full',
                    'bg-[radial-gradient(circle_at_center,var(--app-primary),transparent_60%)]',
                    'opacity-70 blur-md'
                  )}
                />
              </MovingBorder>
            </div>
          )}

          {/* SINGLE framing element kept above; remove border/rounded from this inner wrapper */}
          <div
            className={cn(
              'relative z-20 px-0 pb-10 text-main-view-fg bg-main-view'
            )}
            data-drop-zone={hasMmproj ? 'true' : undefined}
            onDragEnter={hasMmproj ? handleDragEnter : undefined}
            onDragLeave={hasMmproj ? handleDragLeave : undefined}
            onDragOver={hasMmproj ? handleDragOver : undefined}
            onDrop={hasMmproj ? handleDrop : undefined}
          >
            {uploadedFiles.length > 0 && (
              <div className="flex gap-3 items-center p-2 pb-0">
                {uploadedFiles.map((file, index) => {
                  return (
                    <div
                      key={index}
                      className={cn(
                        'relative border border-main-view-fg/5 rounded-lg',
                        file.isTextFile ? 'h-14 min-w-14 px-3 flex items-center' : 'size-14'
                      )}
                    >
                      {file.isTextFile ? (
                        <div className="flex items-center gap-2 max-w-32">
                          <IconFileText className="text-main-view-fg/70 flex-shrink-0" size={16} />
                          <span className="text-xs text-main-view-fg/70 truncate">
                            {file.name}
                          </span>
                        </div>
                      ) : (
                        file.dataUrl && (
                          <img
                            className="object-cover w-full h-full rounded-lg"
                            src={file.dataUrl}
                            alt={`${file.name} - ${index}`}
                          />
                        )
                      )}
                      <div
                        className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer"
                        onClick={() => handleRemoveFile(index)}
                      >
                        <IconX className="text-destructive-fg" size={16} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <TextareaAutosize
              ref={textareaRef}
              disabled={Boolean(streamingContent)}
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
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  prompt.trim() &&
                  !isComposing
                ) {
                  e.preventDefault()
                  // Submit the message when Enter is pressed without Shift
                  handleSendMesage(prompt)
                  // When Shift+Enter is pressed, a new line is added (default behavior)
                }
              }}
              onPaste={hasMmproj ? handlePaste : undefined}
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
                {model?.provider === 'llamacpp' && loadingModel ? (
                  <ModelLoader />
                ) : (
                  <DropdownModelProvider
                    model={model}
                    useLastUsedModel={initialMessage}
                  />
                )}
                {/* File attachment - now available for all models */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="h-7 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1"
                        onClick={handleAttachmentClick}
                      >
                        <IconPaperclip
                          size={18}
                          className="text-main-view-fg/50"
                        />
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          multiple
                          onChange={handleFileChange}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{hasMmproj ? t('vision') : 'Attach files'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* Removed stray `)` here to fix the syntax error */}
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
                  hasActiveMCPServers && (
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
                  )}
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
                )}
              </div>
            </div>

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
                variant={
                  !prompt.trim() && uploadedFiles.length === 0
                    ? null
                    : 'default'
                }
                size="icon"
                disabled={!prompt.trim() && uploadedFiles.length === 0}
                data-test-id="send-message-button"
                onClick={() => handleSendMesage(prompt)}
              >
                {streamingContent ? (
                  <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  <ArrowRight className="text-primary-fg" />
                )}
              </Button>
            )}
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
    </div>
  )
}

export default ChatInput

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
  IconPaperclip,
  IconWorld,
  IconAtom,
  IconEye,
  IconTool,
  IconCodeCircle2,
  IconPlayerStopFilled,
  IconX,
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
import { stopAllModels } from '@/services/models'
import { useOutOfContextPromiseModal } from './dialogs/OutOfContextDialog'
import {
  processFiles,
  processClipboardImages,
  type SupportedFileType,
} from '@/utils/fileUtils'
import FileDisplay from '@/components/FileDisplay'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
}

const ChatInput = ({ model, className, initialMessage }: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const { streamingContent, abortControllers, loadingModel, tools } =
    useAppState()
  const { prompt, setPrompt } = usePrompt()
  const { currentThreadId } = useThreads()
  const { t } = useTranslation()
  const { spellCheckChatInput } = useGeneralSetting()

  const { showModal, PromiseModal: OutOfContextModal } =
    useOutOfContextPromiseModal()
  const maxRows = 10

  const { selectedModel } = useModelProvider()
  const { sendMessage } = useChat()
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipToolsAvailable, setTooltipToolsAvailable] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<SupportedFileType[]>([])
  const [connectedServers, setConnectedServers] = useState<string[]>([])

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

  // Check if there are active MCP servers
  const hasActiveMCPServers = connectedServers.length > 0 || tools.length > 0

  const handleSendMesage = (prompt: string) => {
    if (!selectedModel) {
      setMessage('Please select a model to start chatting.')
      return
    }
    if (!prompt.trim()) {
      return
    }
    setMessage('')
    // Pass uploadedFiles to sendMessage for enhanced media processing
    sendMessage(
      prompt,
      showModal,
      uploadedFiles.length > 0 ? uploadedFiles : undefined
    )
    // Clear uploaded files after sending
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
      stopAllModels()
    },
    [abortControllers]
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    try {
      const newFiles = await processFiles(files)
      setUploadedFiles((prev) => [...prev, ...newFiles])
      setMessage('') // Clear any previous error messages
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Failed to process files'
      )
    } finally {
      // Reset file input and focus textarea
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData
    if (!clipboardData) return

    try {
      const newFiles = await processClipboardImages(clipboardData)

      if (newFiles.length > 0) {
        // Prevent default paste behavior only if we found images
        e.preventDefault()
        setUploadedFiles((prev) => [...prev, ...newFiles])
        setMessage('') // Clear any previous error messages
      }
    } catch (error) {
      e.preventDefault() // Prevent paste if there was an error processing images
      setMessage(
        error instanceof Error
          ? error.message
          : 'Failed to process pasted images'
      )
    }
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
              isFocused && 'ring-1 ring-main-view-fg/10'
            )}
          >
            <FileDisplay
              files={uploadedFiles}
              onRemoveFile={handleRemoveFile}
            />
            <TextareaAutosize
              ref={textareaRef}
              disabled={Boolean(streamingContent)}
              minRows={2}
              rows={1}
              maxRows={10}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                // Count the number of newlines to estimate rows
                const newRows = (e.target.value.match(/\n/g) || []).length + 1
                setRows(Math.min(newRows, maxRows))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
                  e.preventDefault()
                  // Submit the message when Enter is pressed without Shift
                  handleSendMesage(prompt)
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
            <div className="px-1 flex items-center gap-1">
              <div
                className={cn(
                  'px-1 flex items-center gap-1',
                  streamingContent && 'opacity-50 pointer-events-none'
                )}
              >
                {model?.provider === 'llama.cpp' && loadingModel ? (
                  <ModelLoader />
                ) : (
                  <DropdownModelProvider
                    model={model}
                    useLastUsedModel={initialMessage}
                  />
                )}
                {/* File attachment - always available */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1 cursor-pointer"
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
                          onChange={handleFileChange}
                          multiple
                          accept="image/*,audio/*,.pdf,.doc,.docx,.txt"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Upload Files (Images, Audio, Documents)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Microphone - always available - Temp Hide */}
                {/* <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconMicrophone size={18} className="text-main-view-fg/50" />
              </div> */}
                {selectedModel?.capabilities?.includes('vision') && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger disabled={dropdownToolsAvailable}>
                        <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                          <IconEye size={18} className="text-main-view-fg/50" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('vision')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {selectedModel?.capabilities?.includes('embeddings') && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
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
                                setTooltipToolsAvailable(false)
                              }}
                            >
                              {(isOpen, toolsCount) => {
                                return (
                                  <div
                                    className={cn(
                                      'h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1 cursor-pointer relative',
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
                        <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
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
                        <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
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
                variant={!prompt.trim() ? null : 'default'}
                size="icon"
                disabled={!prompt.trim()}
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
      <OutOfContextModal />
    </div>
  )
}

export default ChatInput

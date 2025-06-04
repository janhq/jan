import { ThreadMessage } from '@janhq/core'
import { RenderMarkdown } from './RenderMarkdown'
import React, { Fragment, memo, useCallback, useMemo, useState } from 'react'
import {
  IconCopy,
  IconCopyCheck,
  IconRefresh,
  IconTrash,
  IconPencil,
  IconInfoCircle,
} from '@tabler/icons-react'
import { useAppState } from '@/hooks/useAppState'
import { cn } from '@/lib/utils'
import { useMessages } from '@/hooks/useMessages'
import ThinkingBlock from '@/containers/ThinkingBlock'
import ToolCallBlock from '@/containers/ToolCallBlock'
import { useChat } from '@/hooks/useChat'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDate } from '@/utils/formatDate'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'

import CodeEditor from '@uiw/react-textarea-code-editor'
import '@uiw/react-textarea-code-editor/dist.css'
import { useTranslation } from '@/i18n/react-i18next-compat'

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      className="flex items-center gap-1 hover:text-accent transition-colors group relative cursor-pointer"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <IconCopyCheck size={16} className="text-accent" />
          <span className="opacity-100">{t('copied')}</span>
        </>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconCopy size={16} />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('copy')}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </button>
  )
}

// Use memo to prevent unnecessary re-renders, but allow re-renders when props change
export const ThreadContent = memo(
  (
    item: ThreadMessage & {
      isLastMessage?: boolean
      index?: number
      showAssistant?: boolean
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamTools?: any
      contextOverflowModal?: React.ReactNode | null
      showContextOverflowModal?: () => Promise<unknown>
    }
  ) => {
    const [message, setMessage] = useState(item.content?.[0]?.text?.value || '')
    const { t } = useTranslation()

    // Use useMemo to stabilize the components prop
    const linkComponents = useMemo(
      () => ({
        a: ({ ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }),
      []
    )
    const imageUrls = useMemo(() => {
      if (!item.content) return []
      return item.content
        .filter(
          (content) => content.type === 'image_url' && content.image_url?.url
        )
        .map((content) => content.image_url)
        .filter(Boolean)
    }, [item.content])

    const attachedFiles = useMemo(() => {
      if (!item.metadata?.files || !Array.isArray(item.metadata.files))
        return []
      // Filter out image files from the file list since they're displayed as images
      return (
        item.metadata.files as Array<{
          name: string
          type: string
          size: number
        }>
      ).filter((file) => !file.type.startsWith('image/'))
    }, [item.metadata])
    const { streamingContent } = useAppState()

    const text = useMemo(
      () => item.content.find((e) => e.type === 'text')?.text?.value ?? '',
      [item.content]
    )

    const { reasoningSegment, textSegment } = useMemo(() => {
      const isThinking = text.includes('<think>') && !text.includes('</think>')
      if (isThinking) return { reasoningSegment: text, textSegment: '' }

      const match = text.match(/<think>([\s\S]*?)<\/think>/)
      if (match?.index === undefined)
        return { reasoningSegment: undefined, textSegment: text }

      const splitIndex = match.index + match[0].length
      return {
        reasoningSegment: text.slice(0, splitIndex),
        textSegment: text.slice(splitIndex),
      }
    }, [text])

    const { getMessages, deleteMessage } = useMessages()
    const { sendMessage } = useChat()

    const regenerate = useCallback(() => {
      // Only regenerate assistant message is allowed
      deleteMessage(item.thread_id, item.id)
      const threadMessages = getMessages(item.thread_id)
      let toSendMessage = threadMessages.pop()
      while (toSendMessage && toSendMessage?.role !== 'user') {
        deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
        toSendMessage = threadMessages.pop()
      }
      if (toSendMessage) {
        deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
        sendMessage(
          toSendMessage.content?.[0]?.text?.value || '',
          item.showContextOverflowModal
        )
      }
    }, [deleteMessage, getMessages, item, sendMessage])

    const removeMessage = useCallback(() => {
      if (
        item.index !== undefined &&
        (item.role === 'assistant' || item.role === 'tool')
      ) {
        const threadMessages = getMessages(item.thread_id).slice(
          0,
          item.index + 1
        )
        let toSendMessage = threadMessages.pop()
        while (toSendMessage && toSendMessage?.role !== 'user') {
          deleteMessage(toSendMessage.thread_id, toSendMessage.id ?? '')
          toSendMessage = threadMessages.pop()
          // Stop deletion when encountering an assistant message that isn’t a tool call
          if (
            toSendMessage &&
            toSendMessage.role === 'assistant' &&
            !('tool_calls' in (toSendMessage.metadata ?? {}))
          )
            break
        }
      } else {
        deleteMessage(item.thread_id, item.id)
      }
    }, [deleteMessage, getMessages, item])

    const editMessage = useCallback(
      (messageId: string) => {
        const threadMessages = getMessages(item.thread_id)

        const index = threadMessages.findIndex((msg) => msg.id === messageId)
        if (index === -1) return

        // Delete all messages after the edited message
        for (let i = threadMessages.length - 1; i >= index; i--) {
          deleteMessage(threadMessages[i].thread_id, threadMessages[i].id)
        }

        sendMessage(message, item.showContextOverflowModal)
      },
      [
        deleteMessage,
        getMessages,
        item.thread_id,
        message,
        sendMessage,
        item.showContextOverflowModal,
      ]
    )

    const isToolCalls =
      item.metadata &&
      'tool_calls' in item.metadata &&
      Array.isArray(item.metadata.tool_calls) &&
      item.metadata.tool_calls.length

    const assistant = item.metadata?.assistant as
      | { avatar?: React.ReactNode; name?: React.ReactNode }
      | undefined

    return (
      <Fragment>
        {item.content?.[0]?.text && item.role === 'user' && (
          <div className="w-full">
            <div className="flex justify-end w-full h-full text-start break-words whitespace-normal">
              <div className="bg-main-view-fg/4 relative text-main-view-fg p-2 rounded-md inline-block max-w-[80%] ">
                <div className="select-text">
                  <RenderMarkdown
                    content={item.content?.[0].text.value}
                    components={linkComponents}
                    isUser
                  />
                </div>

                {/* Display uploaded images */}
                {imageUrls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {imageUrls.map((image, index) => (
                      <div key={index} className="flex flex-col">
                        <img
                          src={image?.url}
                          alt={image?.detail || `Uploaded image ${index + 1}`}
                          className="max-w-[200px] max-h-[200px] object-contain rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => window.open(image?.url, '_blank')}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Display file information */}
                {attachedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {attachedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="text-xs text-main-view-fg/60 bg-main-view-fg/5 px-2 py-1 rounded"
                      >
                        📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 text-main-view-fg/60 text-xs mt-2">
              <Dialog>
                <DialogTrigger>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex outline-0 items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative">
                        <IconPencil size={16} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('edit')}</p>
                    </TooltipContent>
                  </Tooltip>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('common:dialogs.editMessage.title')}</DialogTitle>
                    <Textarea
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value)
                      }}
                      className="mt-2 resize-none"
                      onKeyDown={(e) => {
                        // Prevent key from being captured by parent components
                        e.stopPropagation()
                      }}
                    />
                    <DialogFooter className="mt-2 flex items-center">
                      <DialogClose asChild>
                        <Button
                          variant="link"
                          size="sm"
                          className="hover:no-underline"
                        >
                          Cancel
                        </Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button
                          disabled={!message}
                          onClick={() => {
                            editMessage(item.id)
                            toast.success(t('common:toast.editMessage.title'), {
                              id: 'edit-message',
                              description: t('common:toast.editMessage.description'),
                            })
                          }}
                        >
                          Save
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogHeader>
                </DialogContent>
              </Dialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                    onClick={() => {
                      deleteMessage(item.thread_id, item.id)
                    }}
                  >
                    <IconTrash size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('delete')}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
        {item.content?.[0]?.text && item.role !== 'user' && (
          <>
            {item.showAssistant && (
              <div className="flex items-center gap-2 mb-3 text-main-view-fg/60">
                {assistant?.avatar && (
                  <div className="flex items-center gap-2 size-8 rounded-md justify-center border border-main-view-fg/10 bg-main-view-fg/5 p-1">
                    <AvatarEmoji
                      avatar={assistant?.avatar}
                      imageClassName="w-6 h-6 object-contain"
                      textClassName="text-base"
                    />
                  </div>
                )}

                <div className="flex flex-col">
                  <span className="text-main-view-fg font-medium">
                    {assistant?.name || 'Jan'}
                  </span>
                  {item?.created_at && item?.created_at !== 0 && (
                    <span className="text-xs mt-0.5">
                      {formatDate(item?.created_at)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {reasoningSegment && (
              <ThinkingBlock
                id={
                  item.isLastMessage
                    ? `${item.thread_id}-last-${reasoningSegment.slice(0, 50).replace(/\s/g, '').slice(-10)}`
                    : `${item.thread_id}-${item.index ?? item.id}`
                }
                text={reasoningSegment}
              />
            )}

            <RenderMarkdown
              content={textSegment.replace('</think>', '')}
              components={linkComponents}
            />

            {isToolCalls && item.metadata?.tool_calls ? (
              <>
                {(item.metadata.tool_calls as ToolCall[]).map((toolCall) => (
                  <ToolCallBlock
                    id={toolCall.tool?.id ?? 0}
                    key={toolCall.tool?.id}
                    name={
                      (item.streamTools?.tool_calls?.function?.name ||
                        toolCall.tool?.function?.name) ??
                      ''
                    }
                    args={
                      item.streamTools?.tool_calls?.function?.arguments ||
                      toolCall.tool?.function?.arguments ||
                      undefined
                    }
                    result={JSON.stringify(toolCall.response)}
                    loading={toolCall.state === 'pending'}
                  />
                ))}
              </>
            ) : null}

            {!isToolCalls && (
              <div className="flex items-center gap-2 text-main-view-fg/60 text-xs">
                <div className={cn('flex items-center gap-2')}>
                  <div
                    className={cn(
                      'flex items-center gap-2',
                      item.isLastMessage &&
                        streamingContent &&
                        streamingContent.thread_id === item.thread_id &&
                        'hidden'
                    )}
                  >
                    <CopyButton text={item.content?.[0]?.text.value || ''} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                          onClick={() => {
                            removeMessage()
                          }}
                        >
                          <IconTrash size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('delete')}</p>
                      </TooltipContent>
                    </Tooltip>
                    <Dialog>
                      <DialogTrigger>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="outline-0 focus:outline-0 flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative">
                              <IconInfoCircle size={16} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('metadata')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t('common:dialogs.messageMetadata.title')}</DialogTitle>
                          <div className="space-y-2">
                            <div className="border border-main-view-fg/10 rounded-md overflow-hidden">
                              <CodeEditor
                                value={JSON.stringify(
                                  item.metadata || {},
                                  null,
                                  2
                                )}
                                language="json"
                                readOnly
                                style={{
                                  fontFamily: 'ui-monospace',
                                  backgroundColor: 'transparent',
                                  height: '100%',
                                }}
                                className="w-full h-full !text-sm"
                              />
                            </div>
                          </div>
                        </DialogHeader>
                      </DialogContent>
                    </Dialog>

                    {item.isLastMessage && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                            onClick={regenerate}
                          >
                            <IconRefresh size={16} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('regenerate')}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <TokenSpeedIndicator
                    streaming={Boolean(
                      item.isLastMessage &&
                        streamingContent &&
                        streamingContent.thread_id === item.thread_id
                    )}
                    metadata={item.metadata}
                  />
                </div>
              </div>
            )}
          </>
        )}
        {/* Legacy single image display - keeping for backward compatibility */}

        {item.type === 'image_url' && item.content?.[0]?.image_url && (
          <div>
            <img
              src={item.content[0].image_url.url}
              alt={item.content[0].image_url.detail || 'Thread image'}
              className="max-w-full rounded-md"
              style={{ maxHeight: '400px', objectFit: 'contain' }}
            />
            {item.content[0].image_url.detail && (
              <p className="text-sm mt-1">{item.content[0].image_url.detail}</p>
            )}
          </div>
        )}
        {item.contextOverflowModal && item.contextOverflowModal}
      </Fragment>
    )
  }
)

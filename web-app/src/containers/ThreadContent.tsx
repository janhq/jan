/* eslint-disable @typescript-eslint/no-explicit-any */
import { ThreadMessage } from '@janhq/core'
import { RenderMarkdown } from './RenderMarkdown'
import React, { Fragment, memo, useCallback, useMemo, useState } from 'react'
import { IconCopy, IconCopyCheck, IconRefresh } from '@tabler/icons-react'
import { useAppState } from '@/hooks/useAppState'
import { cn } from '@/lib/utils'
import { useMessages } from '@/hooks/useMessages'
import ThinkingBlock from '@/containers/ThinkingBlock'
import ToolCallBlock from '@/containers/ToolCallBlock'
import { useChat } from '@/hooks/useChat'
import {
  EditMessageDialog,
  MessageMetadataDialog,
  DeleteMessageDialog,
} from '@/containers/dialogs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDate } from '@/utils/formatDate'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'

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
      streamingThread?: string

      streamTools?: any
      contextOverflowModal?: React.ReactNode | null
      updateMessage?: (item: ThreadMessage, message: string, imageUrls?: string[]) => void
    }
  ) => {
    const { t } = useTranslation()
    const selectedModel = useModelProvider((state) => state.selectedModel)

    // Use useMemo to stabilize the components prop
    const linkComponents = useMemo(
      () => ({
        a: ({ ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }),
      []
    )
    const image = useMemo(() => item.content?.[0]?.image_url, [item])
    // Only check if streaming is happening for this thread, not the content itself
    const isStreamingThisThread = useAppState(
      (state) => state.streamingContent?.thread_id === item.thread_id
    )

    const text = useMemo(
      () => item.content.find((e) => e.type === 'text')?.text?.value ?? '',
      [item.content]
    )

    const { reasoningSegment, textSegment } = useMemo(() => {
      // Check for thinking formats
      const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
      const hasAnalysisChannel =
        text.includes('<|channel|>analysis<|message|>') &&
        !text.includes('<|start|>assistant<|channel|>final<|message|>')

      if (hasThinkTag || hasAnalysisChannel)
        return { reasoningSegment: text, textSegment: '' }

      // Check for completed think tag format
      const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
      if (thinkMatch?.index !== undefined) {
        const splitIndex = thinkMatch.index + thinkMatch[0].length
        return {
          reasoningSegment: text.slice(0, splitIndex),
          textSegment: text.slice(splitIndex),
        }
      }

      // Check for completed analysis channel format
      const analysisMatch = text.match(
        /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
      )
      if (analysisMatch?.index !== undefined) {
        const splitIndex = analysisMatch.index + analysisMatch[0].length
        return {
          reasoningSegment: text.slice(0, splitIndex),
          textSegment: text.slice(splitIndex),
        }
      }

      return { reasoningSegment: undefined, textSegment: text }
    }, [text])

    const getMessages = useMessages((state) => state.getMessages)
    const deleteMessage = useMessages((state) => state.deleteMessage)
    const sendMessage = useChat()

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
        // Extract text content and any attachments
        const textContent =
          toSendMessage.content?.find((c) => c.type === 'text')?.text?.value ||
          ''
        const attachments = toSendMessage.content
          ?.filter((c) => (c.type === 'image_url' && c.image_url?.url) || false)
          .map((c) => {
            if (c.type === 'image_url' && c.image_url?.url) {
              const url = c.image_url.url
              const [mimeType, base64] = url
                .replace('data:', '')
                .split(';base64,')
              return {
                name: 'image', // We don't have the original filename
                type: mimeType,
                size: 0, // We don't have the original size
                base64: base64,
                dataUrl: url,
              }
            }
            return null
          })
          .filter(Boolean) as Array<{
          name: string
          type: string
          size: number
          base64: string
          dataUrl: string
        }>
        sendMessage(textContent, true, attachments)
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
        {item.role === 'user' && (
          <div className="w-full">
            {/* Render attachments above the message bubble */}
            {item.content?.some(
              (c) => (c.type === 'image_url' && c.image_url?.url) || false
            ) && (
              <div className="flex justify-end w-full mb-2">
                <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
                  {item.content
                    ?.filter(
                      (c) =>
                        (c.type === 'image_url' && c.image_url?.url) || false
                    )
                    .map((contentPart, index) => {
                      // Handle images
                      if (
                        contentPart.type === 'image_url' &&
                        contentPart.image_url?.url
                      ) {
                        return (
                          <div key={index} className="relative">
                            <img
                              src={contentPart.image_url.url}
                              alt="Uploaded attachment"
                              className="size-40 rounded-md object-cover border border-main-view-fg/10"
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                </div>
              </div>
            )}

            {/* Render text content in the message bubble */}
            {item.content?.some((c) => c.type === 'text' && c.text?.value) && (
              <div className="flex justify-end w-full h-full text-start break-words whitespace-normal">
                <div className="bg-main-view-fg/4 relative text-main-view-fg p-2 rounded-md inline-block max-w-[80%] ">
                  <div className="select-text">
                    {item.content
                      ?.filter((c) => c.type === 'text' && c.text?.value)
                      .map((contentPart, index) => (
                        <div key={index}>
                          <RenderMarkdown
                            content={contentPart.text!.value}
                            components={linkComponents}
                            isUser
                          />
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 text-main-view-fg/60 text-xs mt-2">
              <EditMessageDialog
                message={
                  item.content?.find((c) => c.type === 'text')?.text?.value ||
                  ''
                }
                imageUrls={item.content?.filter((c) => c.type === 'image_url' && c.image_url?.url).map((c) => c.image_url!.url).filter((url): url is string => url !== undefined) || []}
                onSave={(message, imageUrls) => {
                  if (item.updateMessage) {
                    item.updateMessage(item, message, imageUrls)
                  }
                }}
              />
              <DeleteMessageDialog
                onDelete={() => deleteMessage(item.thread_id, item.id)}
              />
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
                      item.isLastMessage && isStreamingThisThread && 'hidden'
                    )}
                  >
                    <EditMessageDialog
                      message={item.content?.[0]?.text.value || ''}
                      onSave={(message) =>
                        item.updateMessage && item.updateMessage(item, message)
                      }
                    />
                    <CopyButton text={item.content?.[0]?.text.value || ''} />
                    <DeleteMessageDialog onDelete={removeMessage} />
                    <MessageMetadataDialog metadata={item.metadata} />

                    {item.isLastMessage && selectedModel && (
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
                    streaming={Boolean(item.isLastMessage && isStreamingThisThread)}
                    metadata={item.metadata}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {item.type === 'image_url' && image && (
          <div>
            <img
              src={image.url}
              alt={image.detail || 'Thread image'}
              className="max-w-full rounded-md"
            />
            {image.detail && <p className="text-sm mt-1">{image.detail}</p>}
          </div>
        )}
        {item.contextOverflowModal && item.contextOverflowModal}
      </Fragment>
    )
  }
)

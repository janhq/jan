/* eslint-disable no-case-declarations */
import { memo, useState } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import {
  TOOL_STATE,
  CHAT_STATUS,
  CONTENT_TYPE,
  MESSAGE_ROLE,
} from '@/constants'
import { useResolvedMediaUrl } from '@/hooks/use-resolved-media-url'
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
  MessageAttachments,
  MessageAttachment,
} from '@/components/ai-elements/message'
import {
  PromptInputHoverCard,
  PromptInputHoverCardContent,
} from '@/components/ai-elements/prompt-input'
import { HoverCardTrigger } from '@/components/ui/hover-card'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { CopyIcon, CheckIcon, RefreshCcwIcon, DownloadIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { cn } from '@/lib/utils'

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: ChatStatus
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  onRegenerate?: (messageId: string) => Promise<void>
}

export const MessageItem = memo(
  ({
    message,
    isFirstMessage,
    isLastMessage,
    status,
    reasoningContainerRef,
    onRegenerate,
  }: MessageItemProps) => {
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)

    const handleCopy = (text: string) => {
      navigator.clipboard.writeText(text.trim())
      setCopiedMessageId(message.id)
      setTimeout(() => setCopiedMessageId(null), 2000)
    }

    const handleRegenerate = () => {
      onRegenerate?.(message.id)
    }

    const isStreaming = isLastMessage && status === CHAT_STATUS.STREAMING

    const renderTextPart = (part: { text: string }, partIndex: number) => {
      const isLastPart = partIndex === message.parts.length - 1

      return (
        <Message
          key={`${message.id}-${partIndex}`}
          from={message.role}
          className={cn(
            'group',
            isFirstMessage && message.role === MESSAGE_ROLE.USER && 'mt-0!'
          )}
        >
          <MessageContent
            className={cn(
              'leading-relaxed',
              message.role === MESSAGE_ROLE.USER && 'whitespace-pre-wrap'
            )}
          >
            {message.role === MESSAGE_ROLE.USER ? (
              part.text
            ) : (
              <MessageResponse>{part.text}</MessageResponse>
            )}
          </MessageContent>

          {message.role === MESSAGE_ROLE.USER && isLastPart && (
            <MessageActions
              className={cn(
                'gap-0 justify-end transition-opacity',
                status === CHAT_STATUS.STREAMING
                  ? 'opacity-0 pointer-events-none'
                  : 'opacity-0 group-hover:opacity-100'
              )}
            >
              {onRegenerate && (
                <MessageAction onClick={handleRegenerate} label="Retry">
                  <RefreshCcwIcon className="text-muted-foreground size-3" />
                </MessageAction>
              )}
              <MessageAction onClick={() => handleCopy(part.text)} label="Copy">
                {copiedMessageId === message.id ? (
                  <CheckIcon className="text-green-600 dark:text-green-400 size-3" />
                ) : (
                  <CopyIcon className="text-muted-foreground size-3" />
                )}
              </MessageAction>
            </MessageActions>
          )}

          {message.role === MESSAGE_ROLE.ASSISTANT && isLastPart && (
            <MessageActions
              className={cn(
                'mt-1 gap-0 transition-opacity',
                status === CHAT_STATUS.STREAMING &&
                  'opacity-0 pointer-events-none'
              )}
            >
              <MessageAction onClick={() => handleCopy(part.text)} label="Copy">
                {copiedMessageId === message.id ? (
                  <CheckIcon className="text-green-600 dark:text-green-400 size-3" />
                ) : (
                  <CopyIcon className="text-muted-foreground size-3" />
                )}
              </MessageAction>
              {onRegenerate && (
                <MessageAction onClick={handleRegenerate} label="Retry">
                  <RefreshCcwIcon className="text-muted-foreground size-3" />
                </MessageAction>
              )}
            </MessageActions>
          )}
        </Message>
      )
    }

    const renderFilePart = (part: { filename?: string, url?: string, mediaType?: string }, partIndex: number) => {
      const isAssistant = message.role === MESSAGE_ROLE.ASSISTANT
      const isImage = part.mediaType?.startsWith('image/')
      const isLastPart = partIndex === message.parts.length - 1

      // Resolve Jan media URL to displayable URL using shared hook
      const { displayUrl, isLoading } = useResolvedMediaUrl(part.url)

      const handleDownload = async () => {
        if (!displayUrl) return

        try {
          const response = await fetch(displayUrl)
          const blob = await response.blob()
          const url = window.URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = part.filename || 'generated-image.png'
          document.body.appendChild(a)
          a.click()
          window.URL.revokeObjectURL(url)
          document.body.removeChild(a)
        } catch (error) {
          console.error('Failed to download image:', error)
        }
      }

      const attachmentElement = (
        <MessageAttachment
          data={part as any}
          key={part.filename || 'image'}
          className={cn(
            isAssistant && 'size-64' // Bigger for assistant (size-64 = 16rem = 256px vs size-24 = 6rem = 96px)
          )}
        />
      )

      return (
        <Message
          key={`${message.id}-${partIndex}`}
          from={message.role}
          className="group"
        >
          <MessageAttachments
            className={cn(
              isAssistant && 'ml-0 mr-auto' // Left-align for assistant
            )}
          >
            {isImage && displayUrl ? (
              <PromptInputHoverCard>
                <HoverCardTrigger asChild>
                  {attachmentElement}
                </HoverCardTrigger>
                <PromptInputHoverCardContent className="w-auto p-2">
                  {isLoading ? (
                    <div className="flex h-96 w-96 items-center justify-center">
                      <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    </div>
                  ) : (
                    <div className="flex max-h-96 w-96 items-center justify-center overflow-hidden rounded-md border">
                      <img
                        alt={part.filename || 'Generated image'}
                        className="max-h-full max-w-full object-contain"
                        src={displayUrl}
                      />
                    </div>
                  )}
                </PromptInputHoverCardContent>
              </PromptInputHoverCard>
            ) : (
              attachmentElement
            )}
          </MessageAttachments>

          {/* Message actions for assistant images */}
          {message.role === MESSAGE_ROLE.ASSISTANT && isImage && displayUrl && isLastPart && (
            <MessageActions
              className={cn(
                'gap-0 transition-opacity',
                status === CHAT_STATUS.STREAMING && 'opacity-0 pointer-events-none'
              )}
            >
              <MessageAction onClick={handleDownload} label="Download">
                <DownloadIcon className="text-muted-foreground size-3" />
              </MessageAction>
            </MessageActions>
          )}
        </Message>
      )
    }

    const renderReasoningPart = (part: { text: string }, partIndex: number) => {
      const isLastPart = partIndex === message.parts.length - 1

      // Only open if this reasoning part is actively being streamed
      // (last part in message AND status is streaming AND this is the last message)
      const shouldBeOpen = isStreaming && isLastPart

      return (
        <Reasoning
          key={`${message.id}-${partIndex}`}
          className="w-full text-muted-foreground"
          isStreaming={isStreaming && isLastPart}
          defaultOpen={shouldBeOpen}
        >
          <ReasoningTrigger />
          <div className="relative">
            {isStreaming && (
              <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-background to-transparent pointer-events-none z-10" />
            )}
            <div
              ref={isStreaming ? reasoningContainerRef : null}
              className={twMerge(
                'w-full overflow-auto relative',
                isStreaming
                  ? 'max-h-32 opacity-70 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                  : 'h-auto opacity-100'
              )}
            >
              <ReasoningContent>{part.text}</ReasoningContent>
            </div>
          </div>
        </Reasoning>
      )
    }

    const renderToolPart = (part: any, partIndex: number) => {
      if (!part.type.startsWith('tool-') || !('state' in part)) {
        return null
      }

      const toolName = part.type.split('-').slice(1).join('-')

      return (
        <Tool
          key={`${message.id}-${partIndex}`}
          className={cn(partIndex < 2 && 'mt-4')}
        >
          <ToolHeader
            title={toolName}
            type={part.type as `tool-${string}`}
            state={part.state}
          />
          <ToolContent>
            <ToolInput input={part.input} />
            {part.state === TOOL_STATE.OUTPUT_AVAILABLE && 'output' in part && (
              <ToolOutput
                output={part.output}
                errorText={'errorText' in part ? part.errorText : undefined}
              />
            )}
            {part.state === TOOL_STATE.OUTPUT_ERROR && (
              <ToolOutput
                output={undefined}
                errorText={'errorText' in part ? part.errorText : undefined}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

    return (
      <div>
        {message.parts.map((part, i) => {
          switch (part.type) {
            case CONTENT_TYPE.TEXT:
              return renderTextPart(part, i)
            case CONTENT_TYPE.FILE:
              return renderFilePart(part, i)
            case CONTENT_TYPE.REASONING:
              return renderReasoningPart(part, i)
            default:
              return renderToolPart(part, i)
          }
        })}
      </div>
    )
  },
  (prevProps, nextProps) => {
    if (nextProps.isLastMessage && nextProps.status === CHAT_STATUS.STREAMING) {
      return false
    }

    return (
      prevProps.message === nextProps.message &&
      prevProps.isFirstMessage === nextProps.isFirstMessage &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.status === nextProps.status
    )
  }
)

MessageItem.displayName = 'MessageItem'

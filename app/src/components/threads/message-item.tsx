/* eslint-disable no-case-declarations */
import { memo, useState } from 'react'
import type { UIMessage } from 'ai'
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
import { CopyIcon, CheckIcon, RefreshCcwIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { cn } from '@/lib/utils'

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: 'streaming' | 'submitted' | 'ready' | 'error'
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

    const renderTextPart = (part: { text: string }, partIndex: number) => {
      const isLastPart = partIndex === message.parts.length - 1

      return (
        <Message
          key={`${message.id}-${partIndex}`}
          from={message.role}
          className={cn(
            'group',
            isFirstMessage && message.role === 'user' && 'mt-0!'
          )}
        >
          <MessageContent
            className={cn(
              'leading-relaxed',
              message.role === 'user' && 'whitespace-pre-wrap'
            )}
          >
            {message.role === 'user' ? (
              part.text
            ) : (
              <MessageResponse>{part.text}</MessageResponse>
            )}
          </MessageContent>

          {message.role === 'user' && isLastPart && (
            <MessageActions className="gap-0 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
              <MessageAction onClick={() => handleCopy(part.text)} label="Copy">
                {copiedMessageId === message.id ? (
                  <CheckIcon className="text-green-600 dark:text-green-400 size-3" />
                ) : (
                  <CopyIcon className="text-muted-foreground size-3" />
                )}
              </MessageAction>
            </MessageActions>
          )}

          {message.role === 'assistant' && isLastPart && (
            <MessageActions className="mt-1 gap-0">
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

    const renderFilePart = (
      part: { filename?: string },
      partIndex: number
    ) => (
      <MessageAttachments className="mb-2" key={`${message.id}-${partIndex}`}>
        <MessageAttachment
          data={part as any}
          key={part.filename || 'image'}
        />
      </MessageAttachments>
    )

    const renderReasoningPart = (
      part: { text: string },
      partIndex: number
    ) => {
      const isLastPart = partIndex === message.parts.length - 1
      const isStreaming = status === 'streaming' && isLastMessage

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
            {part.state === 'output-available' && 'output' in part && (
              <ToolOutput
                output={part.output}
                errorText={'errorText' in part ? part.errorText : undefined}
              />
            )}
            {part.state === 'output-error' && (
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
            case 'text':
              return renderTextPart(part, i)
            case 'file':
              return renderFilePart(part, i)
            case 'reasoning':
              return renderReasoningPart(part, i)
            default:
              return renderToolPart(part, i)
          }
        })}
      </div>
    )
  },
  (prevProps, nextProps) => {
    if (nextProps.isLastMessage && nextProps.status === 'streaming') {
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

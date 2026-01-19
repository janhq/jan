/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useState, useCallback } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { twMerge } from 'tailwind-merge'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/ai-elements/reasoning'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/ai-elements/tool'
import { CopyButton } from './CopyButton'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useModelProvider } from '@/hooks/useModelProvider'
import { IconRefresh } from '@tabler/icons-react'
import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

const TOOL_STATE = {
  OUTPUT_AVAILABLE: 'output-available',
  OUTPUT_ERROR: 'output-error',
} as const

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: ChatStatus
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  onRegenerate?: (messageId: string) => void
  assistant?: { avatar?: React.ReactNode; name?: string }
  showAssistant?: boolean
}

export const MessageItem = memo(
  ({
    message,
    isLastMessage,
    status,
    reasoningContainerRef,
    onRegenerate,
    assistant,
    showAssistant,
  }: MessageItemProps) => {
    const selectedModel = useModelProvider((state) => state.selectedModel)
    const [previewImage, setPreviewImage] = useState<{
      url: string
      filename?: string
    } | null>(null)

    const handleRegenerate = useCallback(() => {
      onRegenerate?.(message.id)
    }, [onRegenerate, message.id])

    const isStreaming = isLastMessage && status === CHAT_STATUS.STREAMING

    // Get full text content for copy button
    const getFullTextContent = useCallback(() => {
      return message.parts
        .filter(
          (part): part is { type: 'text'; text: string } =>
            part.type === CONTENT_TYPE.TEXT
        )
        .map((part) => part.text)
        .join('\n')
    }, [message.parts])

    const renderTextPart = (
      part: { type: 'text'; text: string },
      partIndex: number
    ) => {
      if (!part.text || part.text.trim() === '') {
        return null
      }

      const isLastPart = partIndex === message.parts.length - 1

      return (
        <div key={`${message.id}-${partIndex}`} className="w-full">
          {message.role === 'user' ? (
            <div className="flex justify-end w-full h-full text-start break-words whitespace-normal">
              <div className="bg-main-view-fg/4 relative text-main-view-fg p-2 rounded-md inline-block max-w-[80%]">
                <div className="select-text whitespace-pre-wrap">
                  {part.text}
                </div>
              </div>
            </div>
          ) : (
            <>
              <RenderMarkdown
                content={part.text}
                isStreaming={isStreaming && isLastPart}
                messageId={message.id}
              />
            </>
          )}
        </div>
      )
    }

    const renderFilePart = (
      part: {
        type: 'file'
        filename?: string
        url?: string
        mediaType?: string
      },
      partIndex: number
    ) => {
      const isImage = part.mediaType?.startsWith('image/')

      if (message.role === 'user' && isImage && part.url) {
        return (
          <div
            key={`${message.id}-${partIndex}`}
            className="flex justify-end w-full mb-2"
          >
            <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
              <div className="relative">
                <img
                  src={part.url}
                  alt={part.filename || 'Uploaded attachment'}
                  className="size-40 rounded-md object-cover border border-main-view-fg/10 cursor-pointer"
                  onClick={() =>
                    setPreviewImage({ url: part.url!, filename: part.filename })
                  }
                />
              </div>
            </div>
          </div>
        )
      }

      if (message.role === 'assistant' && isImage && part.url) {
        return (
          <div key={`${message.id}-${partIndex}`} className="my-2">
            <img
              src={part.url}
              alt={part.filename || 'Generated image'}
              className="max-w-full rounded-md cursor-pointer"
              onClick={() =>
                setPreviewImage({ url: part.url!, filename: part.filename })
              }
            />
          </div>
        )
      }

      return null
    }

    const renderReasoningPart = (
      part: { type: 'reasoning'; text: string },
      partIndex: number
    ) => {
      const isLastPart = partIndex === message.parts.length - 1
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
      if (part.type !== 'tool-invocation') {
        return null
      }

      const toolName = part.toolName || 'Unknown Tool'
      const state =
        part.state === 'result'
          ? TOOL_STATE.OUTPUT_AVAILABLE
          : part.state === 'error'
            ? TOOL_STATE.OUTPUT_ERROR
            : 'input-available'

      return (
        <Tool key={`${message.id}-${partIndex}`} state={state} className="mb-4">
          <ToolHeader
            title={toolName}
            type={`tool-${toolName}` as `tool-${string}`}
          />
          <ToolContent title={toolName}>
            <ToolInput
              input={
                typeof part.args === 'string'
                  ? part.args
                  : JSON.stringify(part.args)
              }
            />
            {part.state === 'result' && part.result && (
              <ToolOutput
                output={part.result}
                resolver={(input) => Promise.resolve(input)}
                errorText={undefined}
              />
            )}
            {part.state === 'error' && (
              <ToolOutput
                output={undefined}
                errorText={part.error || 'Tool execution failed'}
                resolver={(input) => Promise.resolve(input)}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

    // Check if message has tool invocations
    const hasToolCalls = message.parts.some(
      (part) => part.type === 'tool-invocation'
    )

    return (
      <div className="w-full">
        {/* Show assistant header for assistant messages */}
        {message.role === 'assistant' && showAssistant && (
          <div className="flex items-center gap-2 mb-3 text-main-view-fg/60">
            {assistant?.avatar && (
              <div className="flex items-center gap-2 size-8 rounded-md justify-center border border-main-view-fg/10 bg-main-view-fg/5 p-1">
                <AvatarEmoji
                  avatar={assistant.avatar}
                  imageClassName="w-6 h-6 object-contain"
                  textClassName="text-base"
                />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-main-view-fg font-medium">
                {assistant?.name || 'Jan'}
              </span>
            </div>
          </div>
        )}

        {/* Render message parts */}
        {message.parts.map((part, i) => {
          switch (part.type) {
            case CONTENT_TYPE.TEXT:
              return renderTextPart(part as { type: 'text'; text: string }, i)
            case CONTENT_TYPE.FILE:
              return renderFilePart(part as any, i)
            case CONTENT_TYPE.REASONING:
              return renderReasoningPart(
                part as { type: 'reasoning'; text: string },
                i
              )
            default:
              return renderToolPart(part, i)
          }
        })}

        {/* Message actions for user messages */}
        {message.role === 'user' && (
          <div className="flex items-center justify-end gap-2 text-main-view-fg/60 text-xs mt-2">
            <CopyButton text={getFullTextContent()} />

            {selectedModel && onRegenerate && (
              <button
                className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                onClick={handleRegenerate}
                title="Regenerate from this message"
              >
                <IconRefresh size={16} />
              </button>
            )}
          </div>
        )}

        {/* Message actions for assistant messages (non-tool) */}
        {message.role === 'assistant' && !hasToolCalls && (
          <div className="flex items-center gap-2 text-main-view-fg/60 text-xs">
            <div
              className={cn('flex items-center gap-2', isStreaming && 'hidden')}
            >
              <CopyButton text={getFullTextContent()} />

              {selectedModel && onRegenerate && !isStreaming && (
                <button
                  className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                  onClick={handleRegenerate}
                  title="Regenerate from this message"
                >
                  <IconRefresh size={16} />
                </button>
              )}
            </div>

            <TokenSpeedIndicator
              streaming={isStreaming}
              metadata={message.metadata as Record<string, unknown> | undefined}
            />
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Always re-render if streaming and this is the last message
    if (nextProps.isLastMessage && nextProps.status === CHAT_STATUS.STREAMING) {
      return false
    }

    return (
      prevProps.message === nextProps.message &&
      prevProps.isFirstMessage === nextProps.isFirstMessage &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.status === nextProps.status &&
      prevProps.showAssistant === nextProps.showAssistant
    )
  }
)

MessageItem.displayName = 'MessageItem'

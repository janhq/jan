/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useState, useCallback, useEffect } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { twMerge } from 'tailwind-merge'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@/components/ai-elements/chain-of-thought'
import { Streamdown } from 'streamdown'
import {
  Tool,
  ToolApprovalActions,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { CopyButton } from './CopyButton'
import { formatDate } from '@/utils/formatDate'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useMessageErrors } from '@/stores/message-errors'
import {
  IconRefresh,
  IconPaperclip,
  IconArrowDown,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { EditMessageDialog } from '@/containers/dialogs/EditMessageDialog'
import { DeleteMessageDialog } from '@/containers/dialogs/DeleteMessageDialog'
import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'
import { extractFilesFromPrompt, FileMetadata } from '@/lib/fileMetadata'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PromptProgress } from '@/components/PromptProgress'
import { useServiceHub } from '@/hooks/useServiceHub'
import { parseCitationsFromToolOutput } from '@/lib/citation-parser'
import type { RagCitation } from '@/components/Citations'
import { useGroundingStore } from '@/stores/grounding-store'
import { injectCitationMarkers } from '@/lib/grounding'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: ChatStatus
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  isReasoningAtBottom?: boolean
  onReasoningScroll?: () => void
  onReasoningScrollToBottom?: () => void
  onRegenerate?: (messageId: string) => void
  onEdit?: (messageId: string, newText: string) => void
  onDelete?: (messageId: string) => void
  assistant?: { avatar?: React.ReactNode; name?: string }
  showAssistant?: boolean
  isAnimating?: boolean
  hideActions?: boolean
}

export const MessageItem = memo(
  ({
    message,
    isFirstMessage,
    isLastMessage,
    status,
    isAnimating,
    hideActions,
    reasoningContainerRef,
    isReasoningAtBottom,
    onReasoningScroll,
    onReasoningScrollToBottom,
    onRegenerate,
    onEdit,
    onDelete,
  }: MessageItemProps) => {
    const selectedModel = useModelProvider((state) => state.selectedModel)
    const metadata = message.metadata as Record<string, unknown> | undefined
    const messageError = useMessageErrors((s) => s.errors[message.id])
    const createdAt = (metadata?.createdAt as Date) ?? new Date()
    const [previewImage, setPreviewImage] = useState<{
      url: string
      filename?: string
    } | null>(null)


    const handleRegenerate = useCallback(() => {
      onRegenerate?.(message.id)
    }, [onRegenerate, message.id])

    const handleEdit = useCallback(
      (newText: string) => {
        onEdit?.(message.id, newText)
      },
      [onEdit, message.id]
    )

    const handleDelete = useCallback(() => {
      onDelete?.(message.id)
    }, [onDelete, message.id])

    // Get image URLs from file parts for the edit dialog
    const imageUrls = useMemo(() => {
      return message.parts
        .filter((part) => {
          if (part.type !== 'file') return false
          const filePart = part as { type: 'file'; url?: string; mediaType?: string }
          return filePart.url && filePart.mediaType?.startsWith('image/')
        })
        .map((part) => (part as { url: string }).url)
    }, [message.parts])

    // A tool part is "pending" until it reaches a terminal state. While any
    // tool on the last assistant message is still pending the turn isn't
    // done — the model will resume once the tool result arrives, even if the
    // SDK briefly reports status as 'ready' between the tool-call stream and
    // the follow-up request.
    const hasPendingToolCall = useMemo(() => {
      if (!isLastMessage || message.role !== 'assistant') return false
      return message.parts.some((part) => {
        if (!part.type?.startsWith('tool-')) return false
        const state = (part as { state?: string }).state
        return (
          state !== 'output-available' &&
          state !== 'output-error' &&
          state !== 'output-denied'
        )
      })
    }, [isLastMessage, message.role, message.parts])

    const isStreaming =
      (isLastMessage &&
        (status === CHAT_STATUS.STREAMING ||
          status === CHAT_STATUS.SUBMITTED)) ||
      hasPendingToolCall

    const ragCitations = useMemo<RagCitation[]>(() => {
      if (message.role !== 'assistant') return []
      const out: RagCitation[] = []
      for (const part of message.parts as any[]) {
        if (!part.type?.startsWith('tool-')) continue
        if (part.state !== 'output-available') continue
        const parsed = parseCitationsFromToolOutput(part.output)
        if (parsed?.kind === 'rag') out.push(...parsed.citations)
      }
      return out
    }, [message.parts, message.role])

    const serviceHub = useServiceHub()
    const grounding = useGroundingStore((s) => s.byMessageId[message.id])
    const ensureGrounding = useGroundingStore((s) => s.ensure)

    const assistantText = useMemo(() => {
      if (message.role !== 'assistant') return ''
      return (message.parts as any[])
        .filter((p) => p.type === CONTENT_TYPE.TEXT && p.text)
        .map((p) => p.text)
        .join('\n')
    }, [message.parts, message.role])

    useEffect(() => {
      if (isStreaming) return
      if (!assistantText || !ragCitations.length) return
      const rag = serviceHub.rag()
      if (!rag.embed) return
      ensureGrounding(
        message.id,
        assistantText,
        ragCitations,
        rag.embed.bind(rag)
      )
    }, [
      isStreaming,
      assistantText,
      ragCitations,
      message.id,
      ensureGrounding,
      serviceHub,
    ])

    // Extract file metadata from message text (for user messages with attachments)
    const attachedFiles = useMemo(() => {
      if (message.role !== 'user') return []

      const textParts = message.parts.filter(
        (part): part is { type: 'text'; text: string } =>
          part.type === CONTENT_TYPE.TEXT
      )

      if (textParts.length === 0) return []

      const { files } = extractFilesFromPrompt(textParts[0].text)
      return files
    }, [message.parts, message.role])

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

      // For user messages, extract and clean the text from file metadata
      const displayText =
        message.role === 'user'
          ? extractFilesFromPrompt(part.text).cleanPrompt
          : part.text

      if (
        !displayText.trim() &&
        message.role === 'user' &&
        attachedFiles.length === 0
      ) {
        return null
      }

      return (
        <div key={`${message.id}-${partIndex}`} className="w-full">
          {message.role === 'user' ? (
            <div className="flex justify-end w-full h-full text-start wrap-break-word whitespace-normal">
              <div className="bg-secondary relative text-foreground p-2 rounded-md inline-block max-w-[80%]">
                {/* Show attached files if any */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {attachedFiles.map((file: FileMetadata, idx: number) => (
                      <div
                        key={`file-${idx}-${file.id}`}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-secondary border text-xs"
                      >
                        <IconPaperclip
                          size={14}
                          className="text-muted-foreground"
                        />
                        <span className="font-medium">{file.name}</span>
                        {file.injectionMode && (
                          <span className="text-muted-foreground">
                            ({file.injectionMode})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {displayText && (
                  <div dir="auto" className="select-text whitespace-pre-wrap">
                    {displayText}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <RenderMarkdown
                content={
                  grounding && !isStreaming
                    ? injectCitationMarkers(
                        part.text,
                        grounding.sentenceCitations,
                        `cite-${message.id}`
                      )
                    : part.text
                }
                isStreaming={isStreaming && isLastPart}
                messageId={message.id}
                isAnimating={isAnimating}
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
      const isAudio =
        part.mediaType === 'audio/wav' || part.mediaType === 'audio/mpeg'

      if (isAudio && part.url) {
        const justify =
          message.role === 'user' ? 'justify-end' : 'justify-start'
        return (
          <div
            key={`${message.id}-${partIndex}`}
            className={`flex ${justify} w-full my-2`}
          >
            <audio
              controls
              src={part.url}
              className="max-w-[80%] rounded-md"
            />
          </div>
        )
      }

      if (message.role === 'user' && isImage && part.url) {
        return (
          <div
            key={`${message.id}-${partIndex}`}
            className="flex justify-end w-full my-2"
          >
            <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
              <div className="relative">
                <img
                  src={part.url}
                  alt={part.filename || 'Uploaded attachment'}
                  className="size-20 rounded-lg object-cover border cursor-pointer"
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

    const renderToolInline = (part: any, partIndex: number) => {
      if (!part.type.startsWith('tool-') || !('state' in part)) {
        return null
      }

      const toolName = part.type.split('-').slice(1).join('-')
      return (
        <Tool
          key={`${message.id}-${partIndex}`}
          state={part.state}
          toolCallId={part.toolCallId}
          messageId={message.id}
          className="mb-1"
        >
          <ToolHeader
            title={toolName}
            type={`tool-${toolName}` as `tool-${string}`}
            state={part.state}
          />
          <ToolContent title={toolName}>
            {part.input && <ToolInput input={part.input} />}
            <ToolApprovalActions />
            {part.output && (
              <ToolOutput
                output={part.output}
                resolver={(input) => Promise.resolve(input)}
                errorText={undefined}
              />
            )}
            {part.state === 'output-error' && (
              <ToolOutput
                output={undefined}
                errorText={part.error || part.errorText || 'Tool execution failed'}
                resolver={(input) => Promise.resolve(input)}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

    // Group consecutive reasoning + tool parts into a single CoT block.
    // Empty text parts and step-start markers (inserted by the AI SDK during
    // multi-step tool use) are absorbed so they don't split the group.
    const isCotPart = (part: any) =>
      part.type === CONTENT_TYPE.REASONING ||
      part.type.startsWith('tool-') ||
      part.type === 'step-start' ||
      (part.type === CONTENT_TYPE.TEXT && (!part.text || part.text.trim() === ''))

    type PartEntry = { part: any; index: number }

    const renderCotGroup = (
      entries: PartEntry[],
      groupKey: string,
      hasFollowingContent: boolean
    ) => {
      const hasReasoning = entries.some(
        (e) => e.part.type === CONTENT_TYPE.REASONING
      )

      // No reasoning in this group — render tool parts directly, no CoT wrapper
      if (!hasReasoning) {
        return entries.map(({ part, index: partIndex }) =>
          renderToolInline(part, partIndex)
        )
      }

      const lastEntryIndex = entries[entries.length - 1].index
      const groupIsStreaming =
        isStreaming && lastEntryIndex === message.parts.length - 1

      return (
        <ChainOfThought
          key={groupKey}
          className="w-full text-muted-foreground"
          isStreaming={groupIsStreaming}
          shouldCollapse={hasFollowingContent}
          defaultOpen={true}
        >
          <ChainOfThoughtHeader />
          <ChainOfThoughtContent>
            {entries.map(({ part, index: partIndex }) => {
              if (part.type === CONTENT_TYPE.REASONING) {
                const isLastMsgPart =
                  partIndex === message.parts.length - 1
                const partIsStreaming = isStreaming && isLastMsgPart

                return (
                  <div
                    key={`${message.id}-r-${partIndex}`}
                    className="relative"
                  >
                    {partIsStreaming && (
                      <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-neutral-50 mask-t-from-98% dark:from-background to-transparent pointer-events-none z-10" />
                    )}
                    <div
                      ref={partIsStreaming ? reasoningContainerRef : null}
                      onScroll={
                        partIsStreaming ? onReasoningScroll : undefined
                      }
                      className={twMerge(
                        'w-full overflow-auto relative',
                        partIsStreaming
                          ? 'max-h-64 opacity-70 mt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                          : 'h-auto opacity-100'
                      )}
                    >
                      <Streamdown
                        animate={true}
                        animationDuration={500}
                      >
                        {part.text}
                      </Streamdown>
                    </div>
                    {partIsStreaming && !isReasoningAtBottom && (
                      <Button
                        className="absolute bottom-2 left-[50%] translate-x-[-50%] rounded-full size-7 z-10"
                        onClick={onReasoningScrollToBottom}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <IconArrowDown className="size-3" />
                      </Button>
                    )}
                  </div>
                )
              }

              // Tool part inside CoT
              return renderToolInline(part, partIndex)
            })}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )
    }

    const renderedParts = useMemo(() => {
      const elements: React.ReactNode[] = []
      let cotBuffer: PartEntry[] = []

      const flushCot = (hasFollowing: boolean) => {
        if (cotBuffer.length === 0) return
        const key = `${message.id}-cot-${cotBuffer[0].index}`
        elements.push(renderCotGroup(cotBuffer, key, hasFollowing))
        cotBuffer = []
      }

      for (let i = 0; i < message.parts.length; i++) {
        const part = message.parts[i] as any
        if (isCotPart(part)) {
          cotBuffer.push({ part, index: i })
        } else {
          flushCot(true) // text/file follows → collapse the CoT
          switch (part.type) {
            case CONTENT_TYPE.TEXT:
              elements.push(
                renderTextPart(part as { type: 'text'; text: string }, i)
              )
              break
            case CONTENT_TYPE.FILE:
              elements.push(renderFilePart(part as any, i))
              break
            default:
              break
          }
        }
      }
      flushCot(false) // end of message, no following content → keep open

      return elements
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message.parts, isStreaming, isReasoningAtBottom, grounding])

    return (
      <div
        className={cn(
          'w-full mb-4',
          message.role === 'user' && !isFirstMessage && 'mt-8'
        )}
      >

        {/* Render message parts */}
        {renderedParts}

        {isLastMessage &&
          message.role === 'assistant' &&
          (hasPendingToolCall || status === CHAT_STATUS.SUBMITTED) && (
            <PromptProgress />
          )}

        {/* Message actions for user messages */}
        {message.role === 'user' && !hideActions && (
          <div className="flex items-center justify-end gap-1 text-muted-foreground text-xs">
            <span className="text-muted-foreground">
              {formatDate(createdAt)}
            </span>
            <CopyButton text={getFullTextContent()} />

            {onEdit && status !== CHAT_STATUS.STREAMING &&
              status !== CHAT_STATUS.SUBMITTED && (
              <EditMessageDialog
                message={getFullTextContent()}
                imageUrls={imageUrls.length > 0 ? imageUrls : undefined}
                onSave={handleEdit}
              />
            )}

            {onDelete && status !== CHAT_STATUS.STREAMING &&
              status !== CHAT_STATUS.SUBMITTED && (
              <DeleteMessageDialog onDelete={handleDelete} />
            )}
          </div>
        )}

        {message.role === 'user' &&
          !hideActions &&
          typeof messageError === 'string' &&
          messageError.length > 0 && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <IconAlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-destructive"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-destructive">
                  Generation failed
                </div>
                <div className="text-muted-foreground break-words">
                  {messageError}
                </div>
              </div>
              {selectedModel && onRegenerate && status !== CHAT_STATUS.STREAMING &&
                status !== CHAT_STATUS.SUBMITTED && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerate}
                    className="shrink-0"
                  >
                    <IconRefresh size={14} />
                    <span>Regenerate</span>
                  </Button>
                )}
            </div>
          )}

        {/* Message actions for assistant messages (non-tool) */}
        {message.role === 'assistant' && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              {!isStreaming && (
                <span className="text-muted-foreground">
                  {formatDate(createdAt)}
                </span>
              )}
              <div
                className={cn(
                  'flex items-center gap-1',
                  (isStreaming || hideActions) && 'hidden'
                )}
              >
                <CopyButton text={getFullTextContent()} />

                {onEdit && !isStreaming && (
                  <EditMessageDialog
                    message={getFullTextContent()}
                    onSave={handleEdit}
                  />
                )}

                {onDelete && !isStreaming && (
                  <DeleteMessageDialog onDelete={handleDelete} />
                )}

                {selectedModel && onRegenerate && !isStreaming && isLastMessage && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleRegenerate}
                    title="Regenerate response"
                  >
                    <IconRefresh size={16} />
                  </Button>
                )}
              </div>

              <TokenSpeedIndicator
                streaming={isStreaming}
                metadata={metadata}
              />
            </div>
          )}

        {/* Image Preview Dialog */}
        {previewImage && (
          <div
            className="fixed inset-0 z-100 bg-black/50 backdrop-blur-md flex items-center justify-center cursor-pointer"
            onClick={() => setPreviewImage(null)}
          >
            <img
              src={previewImage.url}
              alt={previewImage.filename || 'Preview'}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Always re-render if the last message is in-flight (streaming or submitted)
    if (
      nextProps.isLastMessage &&
      (nextProps.status === CHAT_STATUS.STREAMING ||
        nextProps.status === CHAT_STATUS.SUBMITTED)
    ) {
      return false
    }

    return (
      prevProps.message === nextProps.message &&
      prevProps.isFirstMessage === nextProps.isFirstMessage &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.status === nextProps.status &&
      prevProps.showAssistant === nextProps.showAssistant &&
      prevProps.hideActions === nextProps.hideActions
    )
  }
)

MessageItem.displayName = 'MessageItem'

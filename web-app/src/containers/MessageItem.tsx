/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useState, useCallback, useEffect, cloneElement } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { twMerge } from 'tailwind-merge'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@/components/ai-elements/chain-of-thought'
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
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useMessageErrors } from '@/stores/message-errors'
import {
  IconRefresh,
  IconPaperclip,
  IconArrowDown,
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react'
import { EditMessageDialog } from '@/containers/dialogs/EditMessageDialog'
import { DeleteMessageDialog } from '@/containers/dialogs/DeleteMessageDialog'
import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'
import { extractFilesFromPrompt, FileMetadata } from '@/lib/fileMetadata'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { PromptProgress } from '@/components/PromptProgress'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { parseCitationsFromToolOutput } from '@/lib/citation-parser'
import type { RagCitation } from '@/components/Citations'
import { useGroundingStore } from '@/stores/grounding-store'
import { injectCitationMarkers } from '@/lib/grounding'
import {
  ReasoningActiveStep,
  StepRow,
} from '@/components/ai-elements/reasoning-timeline'
import { splitReasoningParagraphs } from '@/lib/reasoning'

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
  versionInfo?: { index: number; count: number }
  onSwitchVersion?: (messageId: string, dir: -1 | 1) => void
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
    versionInfo,
    onSwitchVersion,
  }: MessageItemProps) => {
    const selectedModel = useModelProvider((state) => state.selectedModel)
    const coloredUserBubble = useInterfaceSettings((s) => s.coloredUserBubble)
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

    const pendingApprovals = useToolApprovalRequests((s) => s.pending)
    const awaitingApproval = useMemo(() => {
      if (!hasPendingToolCall) return false
      return message.parts.some((part) => {
        const toolCallId = (part as { toolCallId?: string }).toolCallId
        return Boolean(toolCallId && pendingApprovals[toolCallId])
      })
    }, [hasPendingToolCall, message.parts, pendingApprovals])

    const isStreaming =
      (isLastMessage &&
        (status === CHAT_STATUS.STREAMING ||
          status === CHAT_STATUS.SUBMITTED)) ||
      hasPendingToolCall

    // Aggregate RAG citations in part order and record each rag tool part's
    // base offset, so its card numbers/anchors continue the same global
    // sequence the inline superscript markers use.
    const { ragCitations, citationOffsets } = useMemo(() => {
      const out: RagCitation[] = []
      const offsets = new Map<number, number>()
      if (message.role === 'assistant') {
        const parts = message.parts as any[]
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]
          if (!part.type?.startsWith('tool-')) continue
          if (part.state !== 'output-available') continue
          const parsed = parseCitationsFromToolOutput(part.output)
          if (parsed?.kind === 'rag') {
            offsets.set(i, out.length)
            out.push(...parsed.citations)
          }
        }
      }
      return { ragCitations: out, citationOffsets: offsets }
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
              <div
                className={cn(
                  'relative p-2 rounded-md inline-block max-w-[80%]',
                  coloredUserBubble
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground'
                )}
              >
                {/* Show attached files if any */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {attachedFiles.map((file: FileMetadata, idx: number) => (
                      <div
                        key={`file-${idx}-${file.id}`}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-secondary text-secondary-foreground border text-xs"
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
      const isVideo = part.mediaType?.startsWith('video/')

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

      if (isVideo && part.url) {
        const justify =
          message.role === 'user' ? 'justify-end' : 'justify-start'
        return (
          <div
            key={`${message.id}-${partIndex}`}
            className={`flex ${justify} w-full my-2`}
          >
            <video
              controls
              src={part.url}
              className="max-w-[80%] max-h-80 rounded-md border"
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
                citationOffset={citationOffsets.get(partIndex) ?? 0}
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

    type PartEntry = { part: any; index: number }

    const renderCotGroup = (
      entries: PartEntry[],
      groupKey: string,
      hasFollowingContent: boolean
    ) => {
      const hasTools = entries.some((e) => e.part.type.startsWith('tool-'))

      const lastEntryIndex = entries[entries.length - 1].index
      const groupIsStreaming =
        isStreaming && lastEntryIndex === message.parts.length - 1

      // While streaming, surface only the latest step (current reasoning
      // paragraph or tool call) so each step replaces the previous one rather
      // than the whole trace scrolling by. The full trace renders once done.
      const isMeaningfulEntry = ({ part }: PartEntry) => {
        if (part.type === CONTENT_TYPE.REASONING || part.type === CONTENT_TYPE.TEXT) {
          return Boolean(part.text && part.text.trim())
        }
        return part.type.startsWith('tool-') && 'state' in part
      }
      const meaningful = entries.filter(isMeaningfulEntry)
      // While streaming, show only the latest step — but never truncate away a
      // tool part that is awaiting the user's approval, or its approve/deny
      // controls would never mount and the run would hang (multi-tool turns).
      const lastMeaningful = meaningful[meaningful.length - 1]
      const visibleEntries =
        groupIsStreaming && meaningful.length > 0
          ? meaningful.filter((e) => {
              if (e === lastMeaningful) return true
              const toolCallId = (e.part as { toolCallId?: string }).toolCallId
              return Boolean(toolCallId && pendingApprovals[toolCallId])
            })
          : entries

      // Streaming label reflects the current step, not whether the whole trace
      // ever used a tool — otherwise it sticks on "Using tools…" once the model
      // resumes reasoning after a tool call.
      const currentStepIsTool =
        meaningful.length > 0 &&
        meaningful[meaningful.length - 1].part.type.startsWith('tool-')

      // Only reasoning text is worth expanding for — a tool-only step collapses
      // to the header. While streaming that means the current step is a
      // reasoning paragraph that has completed at least once (something for
      // ReasoningActiveStep to render); once done, any reasoning text qualifies.
      const hasDisplayableContent = groupIsStreaming
        ? lastMeaningful?.part.type === CONTENT_TYPE.REASONING &&
          splitReasoningParagraphs(lastMeaningful.part.text ?? '').length >= 2
        : entries.some(
            (e) =>
              e.part.type === CONTENT_TYPE.REASONING &&
              Boolean(e.part.text && e.part.text.trim())
          )

      // Force open only while a tool awaits approval — its approve/deny controls
      // live inside the collapsible and must stay mounted. A running (already
      // approved) tool does not force it open, so tool-only steps collapse.
      const forceOpen = awaitingApproval
      const shouldCollapse = hasFollowingContent || !hasDisplayableContent

      // Done/historical: flatten every entry (reasoning paragraphs, tool calls,
      // interstitial text, files) into steps on a single continuous dotted rail,
      // so a tool call between two reasoning paragraphs stays threaded instead of
      // restarting the rail.
      const renderTimeline = (rows: PartEntry[]) => {
        const steps: React.ReactNode[] = []
        for (const { part, index: partIndex } of rows) {
          if (part.type === CONTENT_TYPE.REASONING) {
            for (const [pi, para] of splitReasoningParagraphs(
              part.text ?? ''
            ).entries()) {
              steps.push(
                <StepRow key={`${message.id}-r-${partIndex}-${pi}`} text={para} />
              )
            }
            continue
          }
          if (part.type === CONTENT_TYPE.TEXT) {
            if (!part.text || part.text.trim() === '') continue
            steps.push(
              <StepRow key={`${message.id}-it-${partIndex}`} text={part.text} />
            )
            continue
          }
          if (part.type === CONTENT_TYPE.FILE) {
            const node = renderFilePart(part, partIndex)
            if (node)
              steps.push(
                <StepRow key={`${message.id}-f-${partIndex}`}>{node}</StepRow>
              )
            continue
          }
          const toolNode = renderToolInline(part, partIndex)
          if (toolNode)
            steps.push(
              <StepRow key={`${message.id}-t-${partIndex}`}>{toolNode}</StepRow>
            )
        }
        if (steps.length === 0) return null
        return (
          <ol className="relative flex flex-col gap-2.5">
            {steps.map((step, i) =>
              step && typeof step === 'object' && 'props' in step
                ? cloneElement(step as React.ReactElement<{ connector?: boolean }>, {
                    connector: i < steps.length - 1,
                  })
                : step
            )}
          </ol>
        )
      }

      return (
        <ChainOfThought
          key={groupKey}
          className="w-full text-muted-foreground"
          isStreaming={groupIsStreaming}
          shouldCollapse={shouldCollapse}
          forceOpen={forceOpen}
          defaultOpen={hasDisplayableContent && !hasFollowingContent}
        >
          <ChainOfThoughtHeader
            streamingLabel={currentStepIsTool ? 'Using tools...' : 'Thinking'}
            completedVerb={hasTools ? 'Worked' : 'Thought'}
          />
          <ChainOfThoughtContent>
            {groupIsStreaming
              ? visibleEntries.map(({ part, index: partIndex }) => {
                  if (part.type === CONTENT_TYPE.REASONING) {
                    const partIsStreaming =
                      isStreaming && partIndex === message.parts.length - 1

                    // Streaming: show only the current paragraph as a single
                    // active step (bounded height, swaps as each paragraph
                    // completes).
                    if (partIsStreaming) {
                      return (
                        <div
                          key={`${message.id}-r-${partIndex}`}
                          className="relative"
                        >
                          <div
                            ref={reasoningContainerRef}
                            onScroll={onReasoningScroll}
                            className={twMerge(
                              'w-full overflow-auto relative max-h-40',
                              '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                            )}
                          >
                            <ReasoningActiveStep text={part.text} />
                          </div>
                          {!isReasoningAtBottom && (
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

                    return null
                  }

                  if (part.type === CONTENT_TYPE.TEXT) {
                    if (!part.text || part.text.trim() === '') return null
                    return (
                      <div
                        key={`${message.id}-it-${partIndex}`}
                        dir="auto"
                        className="select-text whitespace-pre-wrap wrap-break-word text-sm text-main-view-fg/70"
                      >
                        {part.text}
                      </div>
                    )
                  }

                  if (part.type === CONTENT_TYPE.FILE) {
                    return renderFilePart(part, partIndex)
                  }

                  return renderToolInline(part, partIndex)
                })
              : renderTimeline(visibleEntries)}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )
    }

    const renderedParts = useMemo(() => {
      const parts = message.parts as any[]
      const elements: React.ReactNode[] = []
      const isCotPart = (t: string) =>
        t === CONTENT_TYPE.REASONING || t.startsWith('tool-')

      // Walk parts sequentially and flush the reasoning/tool trace whenever a
      // non-empty answer (text/file) interrupts it, so content emitted between
      // two reasoning blocks renders as a normal message.
      let cotEntries: PartEntry[] = []
      let groupSeq = 0
      const flushCot = (hasFollowing: boolean) => {
        if (cotEntries.length === 0) return
        elements.push(
          renderCotGroup(
            cotEntries,
            `${message.id}-cot-${groupSeq++}`,
            hasFollowing
          )
        )
        cotEntries = []
      }

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const t = part.type as string
        if (isCotPart(t)) {
          cotEntries.push({ part, index: i })
          continue
        }
        if (t === CONTENT_TYPE.TEXT) {
          if (!part.text || part.text.trim() === '') continue
          flushCot(true)
          elements.push(
            renderTextPart(part as { type: 'text'; text: string }, i)
          )
          continue
        }
        if (t === CONTENT_TYPE.FILE) {
          flushCot(true)
          elements.push(renderFilePart(part as any, i))
        }
      }
      flushCot(false)
      return elements
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message.parts, isStreaming, isReasoningAtBottom, grounding])

    const versionNav =
      versionInfo && versionInfo.count > 1 && onSwitchVersion ? (
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground disabled:opacity-40"
            disabled={versionInfo.index <= 1}
            onClick={() => onSwitchVersion(message.id, -1)}
            title="Previous version"
          >
            <IconChevronLeft size={14} />
          </button>
          <span className="tabular-nums">
            {versionInfo.index}/{versionInfo.count}
          </span>
          <button
            type="button"
            className="hover:text-foreground disabled:opacity-40"
            disabled={versionInfo.index >= versionInfo.count}
            onClick={() => onSwitchVersion(message.id, 1)}
            title="Next version"
          >
            <IconChevronRight size={14} />
          </button>
        </div>
      ) : null

    return (
      <div
        className={cn(
          'w-full mb-4 group/message',
          message.role === 'user' && !isFirstMessage && 'mt-8'
        )}
      >

        {/* Render message parts */}
        {renderedParts}

        {isLastMessage &&
          message.role === 'assistant' &&
          !awaitingApproval &&
          (hasPendingToolCall || status === CHAT_STATUS.SUBMITTED) && (
            <div className="mt-2">
              <PromptProgress hideIdle={hasPendingToolCall} />
            </div>
          )}

        {typeof messageError === 'string' && messageError.length > 0 && (
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

        {/* Message actions for user messages */}
        {message.role === 'user' && !hideActions && (
          <div className="flex items-center justify-end gap-1 text-muted-foreground text-xs opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <span className="text-muted-foreground">
              {formatDate(createdAt)}
            </span>
            {versionNav}
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
                {versionNav}
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
      prevProps.hideActions === nextProps.hideActions &&
      prevProps.versionInfo?.index === nextProps.versionInfo?.index &&
      prevProps.versionInfo?.count === nextProps.versionInfo?.count
    )
  }
)

MessageItem.displayName = 'MessageItem'

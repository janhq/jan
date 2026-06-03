import { memo, useState, useCallback } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { twMerge } from 'tailwind-merge'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Tool } from '@/components/ai-elements/tools/tool'
import { CopyButton } from './CopyButton'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { IconRefresh } from '@tabler/icons-react'
import { EditMessageDialog } from '@/containers/dialogs/EditMessageDialog'
import { DeleteMessageDialog } from '@/containers/dialogs/DeleteMessageDialog'
import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'
import { extractFilesFromPrompt, FileMetadata } from '@/lib/fileMetadata'
import { AttachmentChip } from '@/containers/AttachmentChip'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { buildTraceBlocks } from '@/lib/tools/message-trace-parts'
import { ToolRenderer } from '@/components/ai-elements/tools/tool-renderer'
import { TraceBlock } from '@/lib/tools/types'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

type TextTraceBlock = Extract<TraceBlock, { kind: 'text' }>
type ReasoningTraceBlock = Extract<TraceBlock, { kind: 'reasoning' }>
type ToolTraceBlock = Extract<TraceBlock, { kind: 'tool' }>

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: ChatStatus
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
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
    isLastMessage,
    status,
    isAnimating,
    hideActions,
    reasoningContainerRef,
    onRegenerate,
    onEdit,
    onDelete,
  }: MessageItemProps) => {
    const { t } = useTranslation()
    const selectedModel = useModelProvider((state) => state.selectedModel)
    // Global "Disable reasoning" toggle: some providers (e.g. MiniMax) ignore
    // every known API flag and keep streaming chain-of-thought. Hide those
    // parts in the UI so the experience matches the user's intent.
    const disableReasoning = useGeneralSetting(
      (state) => state.disableReasoning
    )
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
          const filePart = part as {
            type: 'file'
            url?: string
            mediaType?: string
          }
          return filePart.url && filePart.mediaType?.startsWith('image/')
        })
        .map((part) => (part as { url: string }).url)
    }, [message.parts])

    const isStreaming = isLastMessage && status === CHAT_STATUS.STREAMING

    // When a tool call has just completed and the assistant is still
    // streaming the next part (text or another tool), show a "Working…"
    // shimmer at the end of the bubble so the UI never feels frozen —
    // especially when reasoning is disabled and the reasoning panel
    // (which would otherwise act as the activity indicator) is hidden.
    const showWorkingShimmer = useMemo(() => {
      if (!isLastMessage) return false
      if (message.role !== 'assistant') return false
      if (status !== CHAT_STATUS.STREAMING) return false
      const visibleParts = message.parts.filter(
        (p) => !(p.type === CONTENT_TYPE.REASONING && disableReasoning)
      )
      const lastVisible = visibleParts[visibleParts.length - 1]
      if (!lastVisible || typeof lastVisible.type !== 'string') return false
      if (!lastVisible.type.startsWith('tool-')) return false
      const toolState = (lastVisible as { state?: string }).state
      return (
        toolState === 'output-available' ||
        toolState === 'output-error' ||
        toolState === 'output-denied'
      )
    }, [isLastMessage, message.role, message.parts, status, disableReasoning])

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

    const renderTextBlock = (block: TextTraceBlock, index: number) => {
      const isLastBlock = index === traceBlocks.length - 1
      const displayText =
        message.role === 'user'
          ? extractFilesFromPrompt(block.text).cleanPrompt
          : block.text

      if (
        !displayText.trim() &&
        message.role === 'user' &&
        attachedFiles.length === 0
      ) {
        return null
      }

      return (
        <div key={block.key} className="w-full">
          {message.role === 'user' ? (
            <div className="flex justify-end w-full h-full text-start wrap-break-word whitespace-normal">
              <div className="bg-secondary relative text-foreground p-2 rounded-md inline-block max-w-[80%]">
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {attachedFiles.map((file: FileMetadata, idx: number) => (
                      <AttachmentChip
                        key={`file-${idx}-${file.id}`}
                        name={file.name}
                        fileType={file.type}
                        size={file.size}
                      />
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
            <RenderMarkdown
              content={block.text}
              isStreaming={isStreaming && isLastBlock}
              messageId={message.id}
              isAnimating={isAnimating}
              enableHtmlPreview
            />
          )}
        </div>
      )
    }

    const renderReasoningBlock = (
      block: ReasoningTraceBlock,
      index: number
    ) => {
      const isLastBlock = index === traceBlocks.length - 1
      const shouldBeOpen = isStreaming && isLastBlock

      return (
        <Reasoning
          key={block.key}
          className="w-full text-muted-foreground"
          isStreaming={isStreaming && isLastBlock}
          defaultOpen={shouldBeOpen}
        >
          <ReasoningTrigger />
          <div className="relative">
            {isStreaming && (
              <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-neutral-50 mask-t-from-98% dark:from-background to-transparent pointer-events-none z-10" />
            )}
            <div
              ref={isStreaming ? reasoningContainerRef : null}
              className={twMerge(
                'w-full overflow-auto relative',
                isStreaming
                  ? 'max-h-32 opacity-70 mt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                  : 'h-auto opacity-100'
              )}
            >
              <ReasoningContent>{block.text}</ReasoningContent>
            </div>
          </div>
        </Reasoning>
      )
    }

    const renderToolBlock = (block: ToolTraceBlock) => {
      return (
        <Tool
          key={block.key}
          state={block.state}
          className="mb-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
        >
          <ToolRenderer presentation={block.presentation} state={block.state} />
        </Tool>
      )
    }

    const traceBlocks = useMemo(
      () => buildTraceBlocks(message, disableReasoning),
      [message, disableReasoning]
    )

    return (
      <div className="w-full mb-4">
        {/* Render message parts */}
        {traceBlocks.map((block, index) => {
          switch (block.kind) {
            case 'text':
              return renderTextBlock(block, index)
            case 'reasoning':
              return renderReasoningBlock(block, index)
            case 'tool':
              return renderToolBlock(block)
            default:
              return null
          }
        })}

        {showWorkingShimmer && (
          <div className="flex flex-row items-center gap-2 mt-2">
            <Shimmer duration={1}>{t('common:working')}</Shimmer>
          </div>
        )}

        {/* Message actions for user messages */}
        {message.role === 'user' && !hideActions && (
          <div className="flex items-center justify-end gap-1 text-muted-foreground text-xs mt-4">
            <CopyButton text={getFullTextContent()} />

            {onEdit && status !== CHAT_STATUS.STREAMING && (
              <EditMessageDialog
                message={getFullTextContent()}
                imageUrls={imageUrls.length > 0 ? imageUrls : undefined}
                onSave={handleEdit}
              />
            )}

            {onDelete && status !== CHAT_STATUS.STREAMING && (
              <DeleteMessageDialog onDelete={handleDelete} />
            )}
          </div>
        )}

        {/* Message actions for assistant messages (non-tool) */}
        {message.role === 'assistant' && (
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs mt-1">
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

              {selectedModel &&
                onRegenerate &&
                !isStreaming &&
                isLastMessage && (
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
              metadata={message.metadata as Record<string, unknown> | undefined}
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
    // Always re-render if streaming and this is the last message
    if (nextProps.isLastMessage && nextProps.status === CHAT_STATUS.STREAMING) {
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

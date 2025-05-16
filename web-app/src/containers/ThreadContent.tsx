import { ThreadMessage } from '@janhq/core'
import { RenderMarkdown } from './RenderMarkdown'
import { Fragment, memo, useMemo, useState } from 'react'
import {
  IconCopy,
  IconCopyCheck,
  IconRefresh,
  IconTrash,
  IconPencil,
} from '@tabler/icons-react'
import { useAppState } from '@/hooks/useAppState'
import { cn } from '@/lib/utils'
import { useMessages } from '@/hooks/useMessages'
import ThinkingBlock from '@/containers/ThinkingBlock'
import ToolCallBlock from '@/containers/ToolCallBlock'

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      className="flex items-center gap-1 hover:text-accent transition-colors group relative"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <IconCopyCheck size={16} className="text-accent" />
          <span className="opacity-100">Copied!</span>
        </>
      ) : (
        <>
          <IconCopy size={16} />
          <span className="opacity-0 w-0 overflow-hidden whitespace-nowrap group-hover:w-auto group-hover:opacity-100 transition-all duration-300 ease-in-out">
            Copy
          </span>
        </>
      )}
    </button>
  )
}

// Use memo to prevent unnecessary re-renders, but allow re-renders when props change
export const ThreadContent = memo(
  (item: ThreadMessage & { isLastMessage?: boolean; index?: number }) => {
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

    const { deleteMessage } = useMessages()

    const isToolCalls =
      item.metadata &&
      'tool_calls' in item.metadata &&
      Array.isArray(item.metadata.tool_calls) &&
      item.metadata.tool_calls.length

    return (
      <Fragment>
        {item.content?.[0]?.text && item.role === 'user' && (
          <div>
            <div className="flex justify-end w-full">
              <div className="bg-accent text-accent-fg p-2 rounded-md inline-block">
                <p className="select-text">{item.content?.[0].text.value}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 text-main-view-fg/60 text-xs mt-2">
              <button
                className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                onClick={() => {
                  console.log('Edit clicked')
                }}
              >
                <IconPencil size={16} />
                <span className="opacity-0 w-0 overflow-hidden whitespace-nowrap group-hover:w-auto group-hover:opacity-100 transition-all duration-300 ease-in-out">
                  Edit
                </span>
              </button>
              <button
                className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                onClick={() => {
                  deleteMessage(item.thread_id, item.id)
                }}
              >
                <IconTrash size={16} />
                <span className="opacity-0 w-0 overflow-hidden whitespace-nowrap group-hover:w-auto group-hover:opacity-100 transition-all duration-300 ease-in-out">
                  Delete
                </span>
              </button>
            </div>
          </div>
        )}
        {item.content?.[0]?.text && item.role !== 'user' && (
          <>
            {reasoningSegment && (
              <ThinkingBlock
                id={item.index ?? Number(item.id)}
                text={reasoningSegment}
              />
            )}

            <RenderMarkdown content={textSegment} components={linkComponents} />

            {isToolCalls && item.metadata?.tool_calls ? (
              <>
                {(item.metadata.tool_calls as ToolCall[]).map((toolCall) => (
                  <ToolCallBlock
                    id={toolCall.tool?.id ?? 0}
                    name={toolCall.tool?.function?.name ?? ''}
                    key={toolCall.tool?.id}
                    result={JSON.stringify(toolCall.response)}
                    loading={toolCall.state === 'pending'}
                  />
                ))}
              </>
            ) : null}

            {!isToolCalls && (
              <div className="flex items-center gap-2 mt-2 text-main-view-fg/60 text-xs">
                <div
                  className={cn(
                    'flex items-center gap-2',
                    item.isLastMessage &&
                      streamingContent &&
                      'opacity-0 visinility-hidden pointer-events-none'
                  )}
                >
                  <CopyButton text={item.content?.[0]?.text.value || ''} />
                  <button
                    className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                    onClick={() => {
                      deleteMessage(item.thread_id, item.id)
                    }}
                  >
                    <IconTrash size={16} />
                    <span className="opacity-0 w-0 overflow-hidden whitespace-nowrap group-hover:w-auto group-hover:opacity-100 transition-all duration-300 ease-in-out">
                      Delete
                    </span>
                  </button>
                  <button
                    className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                    onClick={() => {
                      console.log('Regenerate clicked')
                    }}
                  >
                    <IconRefresh size={16} />
                    <span className="opacity-0 w-0 overflow-hidden whitespace-nowrap group-hover:w-auto group-hover:opacity-100 transition-all duration-300 ease-in-out">
                      Regenerate
                    </span>
                  </button>
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
      </Fragment>
    )
  }
)

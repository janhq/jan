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
  (item: ThreadMessage & { isLastMessage?: boolean }) => {
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

    return (
      <Fragment>
        {item.content?.[0]?.text && item.role === 'user' && (
          <div>
            <div className="flex justify-end w-full">
              <div className="bg-accent text-accent-fg p-2 rounded-md inline-block">
                <p>{item.content?.[0].text.value}</p>
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
                  console.log('Delete clicked')
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
            <RenderMarkdown
              content={item.content?.[0]?.text.value}
              components={linkComponents}
            />
            <div className="flex items-center gap-2 mt-2 text-main-view-fg/60 text-xs">
              {item.isLastMessage && item.role === 'assistant' && (
                <div className="flex items-center gap-1">
                  <span>Speed: 42 tokens/sec</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <CopyButton text={item.content?.[0]?.text.value || ''} />
                <button
                  className="flex items-center gap-1 hover:text-accent transition-colors cursor-pointer group relative"
                  onClick={() => {
                    console.log('Delete clicked')
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
